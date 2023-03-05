import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import tsconfig from './tsconfig.json' assert { type: "json" };
import pkg from './package.json' assert { type: "json" };

export default {
  input: 'src/index.ts',
  output: [{
    file: pkg.main,
    sourcemap: true,
    format: 'cjs'
  }, {
    file: pkg.module,
    format: 'es',
    exports: 'named',
    sourcemap: true
  }],
  plugins: [
    typescript({
      ...tsconfig.compilerOptions,
      sourceMap: true,
      outDir: "dist",
      declaration: true,
      declarationDir: '.',
    }),
    terser(),
  ]
};