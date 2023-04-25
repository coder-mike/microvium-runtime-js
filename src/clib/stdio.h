#pragma once

// Implement in JS
// Note: Microvium only uses snprintf for converting floating point numbers to strings.
extern int mvm_snprintf(char* buf, unsigned long bufSize, const char* format, double x);
