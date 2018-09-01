(module
  (memory 0 1)
  (export "gcd" (func $test::gcd))
  (export "test" (func $test::test))
  (func $test::gcd (param $x i32) (param $y i32) (result i32)
    (block $unknown_block_1 (result i32)
      (if $a_wild_if (result i32) (i32.gt_s (get_local $x) (get_local $y))
          (then
            (block $unknown_block_2 (result i32)
                (call $test::gcd (i32.sub (get_local $x) (get_local $y)) (get_local $y))
              )
          )
          (else
            (if $a_wild_if (result i32) (i32.lt_s (get_local $x) (get_local $y))
                (then
                  (block $unknown_block_3 (result i32)
                      (call $test::gcd (get_local $x) (i32.sub (get_local $y) (get_local $x)))
                    )
                )
                (else
                  (block $unknown_block_4 (result i32)
                      (get_local $x)
                    )
                )
              )
          )
        )
    )
  )
  (func $test::test (result i32)
    (block $unknown_block_5 (result i32)
      (call $test::gcd (i32.const 119) (i32.const 7))
    )
  )
)
