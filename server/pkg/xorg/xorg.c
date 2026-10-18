#include "xorg.h"

static Display *DISPLAY = NULL;
// XTEST virtual keyboard XInput1 device handle — cached so XKey() can dispatch
// via XTestFakeDeviceKeyEvent (XI-aware) instead of XTestFakeKeyEvent (core-only).
// GDK3 selects XI2 for the seat keyboard at startup and ignores core-protocol
// KeyPress events, so core XTest silently drops every key into Firefox.
static XDevice *XTEST_KEYBOARD = NULL;

Display *getXDisplay(void) {
  return DISPLAY;
}

// Discover and open the "Virtual core XTEST keyboard" XInput1 device.
// Must be called after XOpenDisplay. Returns NULL on failure; callers fall back
// to XTestFakeKeyEvent (which doesn't work against modern GDK3, but at least
// doesn't crash).
static XDevice *openXTestKeyboardDevice(Display *display) {
  int ndev = 0;
  XDeviceInfo *devs = XListInputDevices(display, &ndev);
  if (devs == NULL)
    return NULL;

  XDevice *dev = NULL;
  for (int i = 0; i < ndev; i++) {
    if (devs[i].name == NULL)
      continue;
    // Exact match against the XTEST extension's virtual keyboard. X.Org spawns
    // this device at server startup. Use strstr to tolerate naming variations
    // across X servers — e.g. "Virtual core XTEST keyboard" vs "XTEST keyboard".
    if (strstr(devs[i].name, "XTEST") != NULL && strstr(devs[i].name, "keyboard") != NULL) {
      dev = XOpenDevice(display, devs[i].id);
      if (dev != NULL)
        break;
    }
  }

  XFreeDeviceList(devs);
  return dev;
}

int XDisplayOpen(char *name) {
  DISPLAY = XOpenDisplay(name);
  if (DISPLAY == NULL)
    return 1;

  // Best-effort: cache the XTEST keyboard device. If this fails we still return
  // success — XKey falls back to core XTest, which at least preserves the old
  // behaviour (broken, but not a crash).
  XTEST_KEYBOARD = openXTestKeyboardDevice(DISPLAY);
  return 0;
}

void XDisplayClose(void) {
  if (XTEST_KEYBOARD != NULL) {
    XCloseDevice(DISPLAY, XTEST_KEYBOARD);
    XTEST_KEYBOARD = NULL;
  }
  XCloseDisplay(DISPLAY);
}

void XMove(int x, int y) {
  Display *display = getXDisplay();
  XWarpPointer(display, None, DefaultRootWindow(display), 0, 0, 0, 0, x, y);
  XSync(display, 0);
}

void XCursorPosition(int *x, int *y) {
  Display *display = getXDisplay();
  Window root = DefaultRootWindow(display);
  Window window;
  int i;
  unsigned mask;
  XQueryPointer(display, root, &root, &window, x, y, &i, &i, &mask);
}

void XScroll(int deltaX, int deltaY) {
  Display *display = getXDisplay();

  int ydir;
  if (deltaY > 0) {
    ydir = 4; // button 4 is up
  } else {
    ydir = 5; // button 5 is down
  }

  int xdir;
  if (deltaX > 0) {
    xdir = 6; // button 6 is right
  } else {
    xdir = 7; // button 7 is left
  }

  for (int i = 0; i < abs(deltaY); i++) {
    XTestFakeButtonEvent(display, ydir, 1, CurrentTime);
    XTestFakeButtonEvent(display, ydir, 0, CurrentTime);
  }

  for (int i = 0; i < abs(deltaX); i++) {
    XTestFakeButtonEvent(display, xdir, 1, CurrentTime);
    XTestFakeButtonEvent(display, xdir, 0, CurrentTime);
  }

  XSync(display, 0);
}

void XButton(unsigned int button, int down) {
  if (button == 0)
    return;

  Display *display = getXDisplay();
  XTestFakeButtonEvent(display, button, down, CurrentTime);
  XSync(display, 0);
}

static xkeyentry_t *xKeysHead = NULL;

// add keycode->keysym mapping to list
void XKeyEntryAdd(KeySym keysym, KeyCode keycode) {
  xkeyentry_t *entry = (xkeyentry_t *) malloc(sizeof(xkeyentry_t));
  if (entry == NULL)
    return;

  entry->keysym = keysym;
  entry->keycode = keycode;
  entry->next = xKeysHead;
  xKeysHead = entry;
}

// get keycode for keysym from list
KeyCode XKeyEntryGet(KeySym keysym) {
  xkeyentry_t *prev = NULL;
  xkeyentry_t *curr = xKeysHead;

  KeyCode keycode = 0;
  while (curr != NULL) {
    if (curr->keysym == keysym) {
      keycode = curr->keycode;

      if (prev == NULL) {
        xKeysHead = curr->next;
      } else {
        prev->next = curr->next;
      }

      free(curr);
      return keycode;
    }

    prev = curr;
    curr = curr->next;
  }

  return 0;
}

static KeyCode XkbKeysymForState(Display* dpy, KeySym keysym, unsigned int mods) {
  XkbDescPtr xkb = XkbGetMap(dpy, XkbAllComponentsMask, XkbUseCoreKbd);
  if (!xkb)
    return 0;

  unsigned int keycode;
  for (keycode = xkb->min_key_code; keycode <= xkb->max_key_code; keycode++) {
    KeySym symbol;
    unsigned int consumed;
    XkbTranslateKeyCode(xkb, keycode, mods, &consumed, &symbol);
    if (symbol == keysym)
      break;
  }
  if (keycode > xkb->max_key_code)
    keycode = 0;
  XkbFreeKeyboard(xkb, XkbAllComponentsMask, True);
  return keycode;
}

KeyCode XkbKeysymToKeycode(Display* dpy, KeySym keysym) {
  XkbStateRec state;
  XkbGetState(dpy, XkbUseCoreKbd, &state);
  unsigned int mods = XkbBuildCoreState(XkbStateMods(&state), state.group);
  KeyCode keycode = XkbKeysymForState(dpy, keysym, mods);
  if (!keycode && keysym == XK_Tab && (mods & ShiftMask))
    return XkbKeysymForState(dpy, XK_ISO_Left_Tab, mods);
  return keycode;
}

// Add a literal keysym when the current layout cannot produce it. Use the core
// mapping request so applications receive MappingNotify as well as XKB updates.
KeyCode XkbAddKeyKeysym(Display* dpy, KeySym keysym) {
  XkbDescPtr xkb = XkbGetMap(dpy, XkbAllComponentsMask, XkbUseCoreKbd);
  if (!xkb)
    return 0;

  unsigned int key;
  for (key = xkb->max_key_code; key >= xkb->min_key_code; key--) {
    if (XkbKeyNumGroups(xkb, key) == 0)
      break;
  }
  KeyCode keycode = key >= xkb->min_key_code ? key : 0;
  XkbFreeKeyboard(xkb, XkbAllComponentsMask, True);
  if (!keycode)
    return 0;

  // Both levels are literal. Inferring an alphabetic pair would turn an
  // uppercase text/IME keysym into lowercase when no physical Shift is held.
  KeySym symbols[2] = { keysym, keysym };
  XChangeKeyboardMapping(dpy, keycode, 2, symbols, 1);
  return keycode;
}

void XKey(KeySym keysym, int down) {
  if (keysym == 0)
    return;

  Display *display = getXDisplay();
  KeyCode keycode = 0;

  if (!down)
    keycode = XKeyEntryGet(keysym);

  // Try to get keysyms from existing keycodes
  if (keycode == 0)
    keycode = XkbKeysymToKeycode(display, keysym);

  // Software keyboards and IMEs send characters without a held physical
  // Shift key. Prefer the layout's existing shifted key over adding a new
  // mapping, which applications may not have refreshed before this keypress.
  if (keycode == 0 && down) {
    XkbStateRec state;
    XkbGetState(display, XkbUseCoreKbd, &state);
    unsigned int mods = XkbBuildCoreState(XkbStateMods(&state), state.group);
    if (!(mods & ShiftMask)) {
      keycode = XkbKeysymForState(display, keysym, mods | ShiftMask);
      if (keycode)
        XkbLatchModifiers(display, XkbUseCoreKbd, ShiftMask, ShiftMask);
    }
  }

  // Symbols absent from the layout still need a literal fallback mapping.
  if (keycode == 0)
    keycode = XkbAddKeyKeysym(display, keysym);

  if (down)
    XKeyEntryAdd(keysym, keycode);

  // Prefer XTestFakeDeviceKeyEvent: it dispatches via the XTEST XInput device,
  // so XI2 listeners (GDK3 inside Firefox) actually receive the event. The core
  // XTestFakeKeyEvent path produces core-protocol events that GDK3's XI2 keyboard
  // path silently drops.
  if (XTEST_KEYBOARD != NULL) {
    XTestFakeDeviceKeyEvent(display, XTEST_KEYBOARD, keycode, down, NULL, 0, CurrentTime);
  } else {
    XTestFakeKeyEvent(display, keycode, down, CurrentTime);
  }
  XSync(display, 0);
}

Status XSetScreenConfiguration(int width, int height, short rate) {
  Display *display = getXDisplay();
  Window root = DefaultRootWindow(display);
  XRRScreenConfiguration *conf = XRRGetScreenInfo(display, root);

  XRRScreenSize *xrrs;
  int num_sizes;
  xrrs = XRRConfigSizes(conf, &num_sizes);

  int size_index = -1;
  for (int i = 0; i < num_sizes; i++) {
    if (xrrs[i].width == width && xrrs[i].height == height) {
      size_index = i;
      break;
    }
  }

  // if we cannot find the size
  if (size_index == -1) {
    return RRSetConfigFailed;
  }

  Status status;
  status = XRRSetScreenConfigAndRate(display, conf, root, size_index, RR_Rotate_0, rate, CurrentTime);

  XRRFreeScreenConfigInfo(conf);
  return status;
}

void XGetScreenConfiguration(int *width, int *height, short *rate) {
  Display *display = getXDisplay();
  Window root = DefaultRootWindow(display);
  XRRScreenConfiguration *conf = XRRGetScreenInfo(display, root);

  Rotation current_rotation;
  SizeID current_size_id = XRRConfigCurrentConfiguration(conf, &current_rotation);

  XRRScreenSize *xrrs;
  int num_sizes;
  xrrs = XRRConfigSizes(conf, &num_sizes);

  // if we cannot find the size
  if (current_size_id >= num_sizes) {
    return;
  }

  *width = xrrs[current_size_id].width;
  *height = xrrs[current_size_id].height;
  *rate = XRRConfigCurrentRate(conf);

  XRRFreeScreenConfigInfo(conf);
}

void XGetScreenConfigurations() {
  Display *display = getXDisplay();
  Window root = DefaultRootWindow(display);
  XRRScreenSize *xrrs;
  int num_sizes;

  xrrs = XRRSizes(display, 0, &num_sizes);
  for (int i = 0; i < num_sizes; i++) {
    short *rates;
    int num_rates;

    goCreateScreenSize(i, xrrs[i].width, xrrs[i].height, xrrs[i].mwidth, xrrs[i].mheight);
    rates = XRRRates(display, 0, i, &num_rates);
    for (int j = 0; j < num_rates; j++) {
      goSetScreenRates(i, j, rates[j]);
    }
  }
}

// Inspired by https://github.com/raboof/xrandr/blob/master/xrandr.c
void XCreateScreenMode(int width, int height, short rate) {
  Display *display = getXDisplay();
  Window root = DefaultRootWindow(display);

  // create new mode info
  XRRModeInfo *mode_info = XCreateScreenModeInfo(width, height, rate);

  // create new mode
  RRMode mode = XRRCreateMode(display, root, mode_info);
  XSync(display, 0);

  // add new mode to all outputs
	XRRScreenResources *resources = XRRGetScreenResources(display, root);
  for (int i = 0; i < resources->noutput; ++i) {
    XRRAddOutputMode(display, resources->outputs[i], mode);
  }

  XRRFreeScreenResources(resources);
  XRRFreeModeInfo(mode_info);
}

// Inspired by https://fossies.org/linux/xwayland/hw/xwayland/xwayland-cvt.c
XRRModeInfo *XCreateScreenModeInfo(int hdisplay, int vdisplay, short vrefresh) {
  char name[128];
  snprintf(name, sizeof name, "%dx%d_%d", hdisplay, vdisplay, vrefresh);
  XRRModeInfo *modeinfo = XRRAllocModeInfo(name, strlen(name));

#ifdef _LIBCVT_H_
  struct libxcvt_mode_info *mode_info;

  // get screen mode from libxcvt, if available
  mode_info = libxcvt_gen_mode_info(hdisplay, vdisplay, vrefresh, false, false);

  modeinfo->width      = mode_info->hdisplay;
  modeinfo->height     = mode_info->vdisplay;
  modeinfo->dotClock   = mode_info->dot_clock * 1000;
  modeinfo->hSyncStart = mode_info->hsync_start;
  modeinfo->hSyncEnd   = mode_info->hsync_end;
  modeinfo->hTotal     = mode_info->htotal;
  modeinfo->vSyncStart = mode_info->vsync_start;
  modeinfo->vSyncEnd   = mode_info->vsync_end;
  modeinfo->vTotal     = mode_info->vtotal;
  modeinfo->modeFlags  = mode_info->mode_flags;

  free(mode_info);
#else
  // fallback to a simple mode without refresh rate
  modeinfo->width = hdisplay;
  modeinfo->height = vdisplay;
#endif

  return modeinfo;
}

void XSetKeyboardModifier(unsigned char mod, int on) {
  Display *display = getXDisplay();
  XkbLockModifiers(display, XkbUseCoreKbd, mod, on ? mod : 0);
  XFlush(display);
}

unsigned char XGetKeyboardModifiers() {
  XkbStateRec xkbState;
  Display *display = getXDisplay();
  XkbGetState(display, XkbUseCoreKbd, &xkbState);
  // XkbStateFieldFromRec() doesn't work properly because
  // state.lookup_mods isn't properly updated, so we do this manually
  return XkbBuildCoreState(XkbStateMods(&xkbState), xkbState.group);
}

XFixesCursorImage *XGetCursorImage(void) {
  Display *display = getXDisplay();
  return XFixesGetCursorImage(display);
}

char *XGetScreenshot(int *w, int *h) {
  Display *display = getXDisplay();
  Window root = DefaultRootWindow(display);

  XWindowAttributes attr;
  XGetWindowAttributes(display, root, &attr);
  int width = attr.width;
  int height = attr.height;

  XImage *ximage = XGetImage(display, root, 0, 0, width, height, AllPlanes, ZPixmap);

  *w = width;
  *h = height;
  char *pixels = (char *)malloc(width * height * 3);

  for (int row = 0; row < height; row++) {
    for (int col = 0; col < width; col++) {
      int pos = ((row * width) + col) * 3;
      unsigned long pixel = XGetPixel(ximage, col, row);

      pixels[pos]   = (pixel & ximage->red_mask)   >> 16;
      pixels[pos+1] = (pixel & ximage->green_mask) >> 8;
      pixels[pos+2] =  pixel & ximage->blue_mask;
    }
  }

  XDestroyImage(ximage);
  return pixels;
}
