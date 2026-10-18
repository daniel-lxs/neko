// Exercise the production input code against a real X server and read the
// resulting KeyPress as an independent X11 client, as a remote app would.
#include "../xorg.c"
#include <assert.h>
#include <unistd.h>

// Screen-discovery callbacks are unused by this keyboard-only executable.
void goCreateScreenSize(int a, int b, int c, int d, int e) {}
void goSetScreenRates(int a, int b, short c) {}

int main(void) {
  assert(XDisplayOpen(getenv("DISPLAY")) == 0);
  Display *receiver = XOpenDisplay(getenv("DISPLAY"));
  assert(receiver != NULL);
  Window window = XCreateSimpleWindow(receiver, DefaultRootWindow(receiver),
      0, 0, 300, 100, 0, 0, 0xffffff);
  XSelectInput(receiver, window, KeyPressMask | KeyReleaseMask | StructureNotifyMask);
  XMapWindow(receiver, window);
  // Wait for the window manager to map the window before requesting focus.
  XEvent event;
  do {
    XNextEvent(receiver, &event);
  } while (event.type != MapNotify);
  XSetInputFocus(receiver, window, RevertToParent, CurrentTime);
  XSync(receiver, False);

  const char *expected = "AaZzAZ";
  int failed = 0;
  for (const char *p = expected; *p; p++) {
    XKey(*p, 1);
    XKey(*p, 0);
    XSync(receiver, False);
    int found = 0;
    while (XPending(receiver)) {
      XNextEvent(receiver, &event);
      if (event.type == MappingNotify) {
        XRefreshKeyboardMapping(&event.xmapping);
        continue;
      }
      if (event.type != KeyPress)
        continue;
      char text[32] = {0};
      KeySym symbol;
      int length = XLookupString(&event.xkey, text, sizeof(text) - 1, &symbol, NULL);
      printf("expected=%c received=%s keysym=0x%lx modifiers=%u\n",
          *p, text, symbol, event.xkey.state);
      if (length != 1 || text[0] != *p)
        failed = 1;
      found++;
    }
    if (!found) {
      fprintf(stderr, "No KeyPress received for %c\n", *p);
      failed = 1;
    }
  }
  XDestroyWindow(receiver, window);
  XCloseDisplay(receiver);
  XDisplayClose();
  return failed;
}
