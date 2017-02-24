import buble from 'rollup-plugin-buble';

export default {
  entry: 'obj/worker/worker.js',
  dest: 'build/worker.js',
  format: 'iife',
  plugins: [ buble() ]
};
