import buble from 'rollup-plugin-buble';

export default {
  entry: 'obj/ui/ui.js',
  dest: 'build/ui.js',
  format: 'iife',
  external: ['d3'],
  globals: {
    d3: 'd3'
  },
  plugins: [ buble() ]
};
