export const errorMessages = {
  0: ["MVM_E_SUCCESS"],
  1: ["MVM_E_UNEXPECTED"],
  2: ["MVM_E_MALLOC_FAIL"],
  3: ["MVM_E_ALLOCATION_TOO_LARGE"],
  4: ["MVM_E_INVALID_ADDRESS"],
  5: ["MVM_E_COPY_ACROSS_BUCKET_BOUNDARY"],
  6: ["MVM_E_FUNCTION_NOT_FOUND"],
  7: ["MVM_E_INVALID_HANDLE"],
  8: ["MVM_E_STACK_OVERFLOW"],
  9: ["MVM_E_UNRESOLVED_IMPORT"],
  10: ["MVM_E_ATTEMPT_TO_WRITE_TO_ROM"],
  11: ["MVM_E_INVALID_ARGUMENTS"],
  12: ["MVM_E_TYPE_ERROR"],
  13: ["MVM_E_TARGET_NOT_CALLABLE"],
  14: ["MVM_E_HOST_ERROR"],
  15: ["MVM_E_NOT_IMPLEMENTED"],
  16: ["MVM_E_HOST_RETURNED_INVALID_VALUE"],
  17: ["MVM_E_ASSERTION_FAILED"],
  18: ["MVM_E_INVALID_BYTECODE"],
  19: ["MVM_E_UNRESOLVED_EXPORT"],
  20: ["MVM_E_RANGE_ERROR"],
  21: ["MVM_E_DETACHED_EPHEMERAL"],
  22: ["MVM_E_TARGET_IS_NOT_A_VM_FUNCTION"],
  23: ["MVM_E_FLOAT64"],
  24: ["MVM_E_NAN"],
  25: ["MVM_E_NEG_ZERO"],
  26: ["MVM_E_OPERATION_REQUIRES_FLOAT_SUPPORT"],
  27: ["MVM_E_BYTECODE_CRC_FAIL"],
  28: ["MVM_E_BYTECODE_REQUIRES_FLOAT_SUPPORT"],
  29: ["MVM_E_PROTO_IS_READONLY","The __proto__ property of objects and arrays is not mutable"],
  30: ["MVM_E_SNAPSHOT_TOO_LARGE","The resulting snapshot does not fit in the 64kB boundary"],
  31: ["MVM_E_MALLOC_MUST_RETURN_POINTER_TO_EVEN_BOUNDARY"],
  32: ["MVM_E_ARRAY_TOO_LONG"],
  33: ["MVM_E_OUT_OF_MEMORY","Allocating a new block of memory from the host causes it to exceed MVM_MAX_HEAP_SIZE"],
  34: ["MVM_E_TOO_MANY_ARGUMENTS","Exceeded the maximum number of arguments for a function (255)"],
  35: ["MVM_E_REQUIRES_LATER_ENGINE","Please update your microvium.h and microvium.c files"],
  36: ["MVM_E_PORT_FILE_VERSION_MISMATCH","Please migrate your port file to the required version"],
  37: ["MVM_E_PORT_FILE_MACRO_TEST_FAILURE","Something in microvium_port.h doesn't behave as expected"],
  38: ["MVM_E_EXPECTED_POINTER_SIZE_TO_BE_16_BIT","MVM_NATIVE_POINTER_IS_16_BIT is 1 but pointer size is not 16-bit"],
  39: ["MVM_E_EXPECTED_POINTER_SIZE_NOT_TO_BE_16_BIT","MVM_NATIVE_POINTER_IS_16_BIT is 0 but pointer size is 16-bit"],
  40: ["MVM_E_TYPE_ERROR_TARGET_IS_NOT_CALLABLE","The script tried to call something that wasn't a function"],
  41: ["MVM_E_TDZ_ERROR","The script tried to access a local variable before its declaration"],
  42: ["MVM_E_MALLOC_NOT_WITHIN_RAM_PAGE","See instructions in example port file at the defitions MVM_USE_SINGLE_RAM_PAGE and MVM_RAM_PAGE_ADDR"],
  43: ["MVM_E_INVALID_ARRAY_INDEX","Array indexes must be integers in the range 0 to 8191"],
  44: ["MVM_E_UNCAUGHT_EXCEPTION","The script threw an exception with `throw` that was wasn't caught before returning to the host"],
  45: ["MVM_E_FATAL_ERROR_MUST_KILL_VM","Please make sure that MVM_FATAL_ERROR does not return, or bad things can happen. (Kill the process, the thread, or use longjmp)"],
  46: ["MVM_E_OBJECT_KEYS_ON_NON_OBJECT","Can only use Reflect.ownKeys on plain objects (not functions, arrays, or other values)"],
  47: ["MVM_E_INVALID_UINT8_ARRAY_LENGTH","Either non-numeric or out-of-range argument for creating a Uint8Array"],
  48: ["MVM_E_CAN_ONLY_ASSIGN_BYTES_TO_UINT8_ARRAY","Value assigned to index of Uint8Array must be an integer in the range 0 to 255"],
  49: ["MVM_E_WRONG_BYTECODE_VERSION","The version of bytecode is different to what the engine supports"],
  50: ["MVM_E_USING_NEW_ON_NON_CLASS","The `new` operator can only be used on classes"],
  51: ["MVM_E_INSTRUCTION_COUNT_REACHED","The instruction count set by `mvm_stopAfterNInstructions` has been reached"],
  52: ["MVM_E_REQUIRES_ACTIVE_VM","The given operation requires that the VM has active calls on the stack"],
  53: ["MVM_E_ASYNC_START_ERROR","mvm_asyncStart must be called exactly once at the beginning of a host function that is called from JS"],
  54: ["MVM_E_ASYNC_WITHOUT_AWAIT","mvm_asyncStart can only be used with a script that has await points. Add at least one (reachable) await point to the script."],
  55: ["MVM_E_TYPE_ERROR_AWAIT_NON_PROMISE","Can only await a promise in Microvium"],
  56: ["MVM_E_HEAP_CORRUPT","Microvium's internal heap is not in a consistent state"],
  57: ["MVM_E_CLASS_PROTOTYPE_MUST_BE_NULL_OR_OBJECT","The prototype property of a class must be null or a plain object"]
} as const;