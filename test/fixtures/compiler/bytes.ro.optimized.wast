(module
 (type $0 (func))
 (type $1 (func (result i64)))
 (memory $0 1)
 (data (i32.const 16) "\0c\00\00\00a\00s\00d\00a\00s\00d")
 (data (i32.const 33) "\10\00\00\00u\00t\00f\00 \00\ab\00\100\110\bb")
 (global $global$0 (mut i64) (i64.const 0))
 (global $global$1 (mut i64) (i64.const 0))
 (export "memory" (memory $0))
 (export "main" (func $0))
 (start $1)
 (func $0 (; 0 ;) (type $1) (result i64)
  (global.get $global$0)
 )
 (func $1 (; 1 ;) (type $0)
  (global.set $global$0
   (i64.const 16)
  )
  (global.set $global$1
   (i64.const 33)
  )
 )
)
