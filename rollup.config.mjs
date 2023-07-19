import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import pkg from './package.json' assert { type: "json" };

export default {
  input: 'src/index.ts',
  output: [{
    file: pkg.main,
    name: 'Microvium',
    sourcemap: true,
    format: 'umd',
    exports: 'named'
  }, {
    file: pkg.module,
    format: 'es',
    exports: 'named',
    sourcemap: true
  }],
  watch: {
    include: "src/**/*.ts",
    exclude: "node_modules/**/*",
    chokidar: {
      usePolling: true
    }
  },
  plugins: [
    typescript({
      tsconfig: './tsconfig.json'
    }),
    //terser(),
  ]
};