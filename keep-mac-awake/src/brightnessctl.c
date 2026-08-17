/*
 * brightnessctl — read/write built-in display brightness on Apple Silicon.
 *   brightnessctl        -> print current brightness (0.0000 - 1.0000)
 *   brightnessctl 0.5    -> set brightness
 *
 * The public IOKit API returns kIOReturnUnsupported on Apple Silicon built-in
 * panels, so this uses the DisplayServices private framework, resolved at
 * runtime so a future macOS that drops the symbols fails cleanly.
 */
#include <dlfcn.h>
#include <stdio.h>
#include <stdlib.h>

#define FRAMEWORK "/System/Library/PrivateFrameworks/DisplayServices.framework/DisplayServices"
#define BUILTIN 1u

int main(int argc, char **argv) {
  void *fw = dlopen(FRAMEWORK, RTLD_LAZY);
  int (*get)(unsigned, float *) = fw ? dlsym(fw, "DisplayServicesGetBrightness") : NULL;
  int (*set)(unsigned, float)   = fw ? dlsym(fw, "DisplayServicesSetBrightness") : NULL;
  if (!get || !set) {
    fprintf(stderr, "brightnessctl: DisplayServices brightness unavailable\n");
    return 2;
  }

  if (argc > 1) return set(BUILTIN, strtof(argv[1], NULL)) ? 3 : 0;

  float value;
  if (get(BUILTIN, &value)) return 4;
  printf("%.4f\n", value);
  return 0;
}
