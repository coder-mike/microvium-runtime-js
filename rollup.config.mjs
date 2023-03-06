import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import pkg from './package.json' assert { type: "json" };

export default {
  input: 'src/index.ts',
  output: [{
    file: pkg.main,
    name: 'Microvium',
    sourcemap: true,
    format: 'umd'
  }, {
    file: pkg.module,
    format: 'es',
    exports: 'named',
    sourcemap: true
  }],
  plugins: [
    typescript({
      tsconfig: './tsconfig.json'
    }),
    terser(),
  ]
};