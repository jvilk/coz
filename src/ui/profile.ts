import {d3} from './d3-tip';
import {ProfileData, Speedup, MessageFromWorker, ErrorMessage, DataMessage, ProgressMessage, MessageToWorker, FilesMessage} from '../shared/interfaces';
declare let science: any;

interface ExperimentResult {
  name: string;
  progress_points: Point[];
}

interface Point {
  name: string;
  measurements: Measurement[]
}

interface Measurement {
  speedup: number;
  progress_speedup: Speedup;
  num_points: number;
}

/**
 * Formats the title of a graph.
 * Removes everything but the script in URLs so that function names appear.
 * Also strips out ? parameters from URL.
 */
function formatTitle(t: string): string {
  let lastSlash = t.lastIndexOf('/') + 1;
  if (lastSlash === -1) {
    lastSlash = 0;
  }
  let cutoff = t.indexOf('?', lastSlash);
  if (cutoff === -1) {
    cutoff = t.indexOf(' ', lastSlash);
  }
  return `${t.slice(lastSlash, cutoff)} ${t.slice(t.indexOf(' ', cutoff))}`;
}

function getSpeedup(baseline: number, comparison: number) {
  return (baseline - comparison) / baseline;
}

function max_normalized_area(d: ExperimentResult): number {
  let max_normalized_area = 0;
  for (let point of d.progress_points) {
    let area = 0;
    let prev_data = point.measurements[0];
    for (let current_data of point.measurements) {
      let avg_progress_speedup = (prev_data.progress_speedup.value + current_data.progress_speedup.value) / 2;
      area += avg_progress_speedup * (current_data.speedup - prev_data.speedup);
      let normalized_area = area / current_data.speedup;
      if (normalized_area > max_normalized_area) max_normalized_area = normalized_area;
      prev_data = current_data;
    }
  }
  return max_normalized_area;
}

function max_progress_speedup(d: ExperimentResult): number {
  let max_progress_speedup = 0;
  for (let point of d.progress_points) {
    for (let measurement of point.measurements) {
      let progress_speedup = measurement.progress_speedup.value;
      if (progress_speedup > max_progress_speedup) max_progress_speedup = progress_speedup;
    }
  }
  return max_progress_speedup;
}

function min_progress_speedup(d: ExperimentResult): number {
  let min_progress_speedup = 0;
  for (let point of d.progress_points) {
    for (let measurement of point.measurements) {
      let progress_speedup = measurement.progress_speedup.value;
      if (progress_speedup < min_progress_speedup) min_progress_speedup = progress_speedup;
    }
  }
  return min_progress_speedup;
}

const sort_functions: {[name: string]: (a: ExperimentResult, b: ExperimentResult) => number} = {
  alphabetical: function(a: ExperimentResult, b: ExperimentResult): number {
    if(a.name > b.name) return 1;
    else return -1;
  },

  impact: function(a: ExperimentResult, b: ExperimentResult): number {
    if (max_normalized_area(b) > max_normalized_area(a)) return 1;
    else return -1;
  },

  max_speedup: function(a: ExperimentResult, b: ExperimentResult): number {
    if (max_progress_speedup(b) > max_progress_speedup(a)) return 1;
    else return -1;
  },

  min_speedup: function(a: ExperimentResult, b: ExperimentResult): number {
    if (min_progress_speedup(a) > min_progress_speedup(b)) return 1;
    else return -1;
  }
};

export default class Profile {
  private static worker: Worker;
  private static _onProfileReceived: (m: ErrorMessage | DataMessage) => void = null;
  private static _onProgress: (p: ProgressMessage) => void = null;
  public static initializeWorker() {
    if (!Profile.worker) {
      Profile.worker = new Worker('./build/worker.js');
      Profile.worker.addEventListener('message', (e) => {
        const data: MessageFromWorker = e.data;
        switch (data.type) {
          case 'error':
          case 'data':
          if (Profile._onProfileReceived) {
            Profile._onProfileReceived(data);
          }
          break;
          case 'progress':
          if (Profile._onProgress) {
            Profile._onProgress(data);
          }
          break;
        }
      });
    }
  }
  private static sendMessage(m: MessageToWorker): void {
    Profile.worker.postMessage(m);
  }

  public static createProfile(files: (File | Blob)[], container: d3.Selection<HTMLDivElement, null, HTMLDivElement, null>, legend: d3.Selection<HTMLDivElement, null, HTMLDivElement, null>, get_min_points: () => number, display_warning: (title: string, msg: string) => void, cb: (e: ErrorMessage, p?: Profile) => void, progress: (p: ProgressMessage) => void) {
    Profile._onProfileReceived = (m) => {
      Profile._onProfileReceived = Profile._onProgress = null;
      switch (m.type) {
        case 'error':
          return cb(m);
        case 'data':
          return cb(null, new Profile(m.data, container, legend, get_min_points, display_warning));
      }
    };
    Profile._onProgress = progress;
    Profile.sendMessage({
      type: 'files',
      files: files
    });
  }

  private _data: ProfileData = null;
  private _disabled_progress_points: string[] = [];
  private _plot_container: d3.Selection<HTMLDivElement, null, HTMLDivElement, null>;
  private _plot_legend: d3.Selection<HTMLDivElement, null, HTMLDivElement, null>;
  private _get_min_points: () => number;
  private _display_warning: (title: string, msg: string) => void;
  private _progress_points: string[] = null;
  private constructor(data: ProfileData, container: d3.Selection<HTMLDivElement, null, HTMLDivElement, null>, legend: d3.Selection<HTMLDivElement, null, HTMLDivElement, null>, get_min_points: () => number, display_warning: (title: string, msg: string) => void) {
    this._data = data;
    this._plot_container = container;
    this._plot_legend = legend;
    this._get_min_points = get_min_points;
    this._display_warning = display_warning;
  }

  public getProgressPoints(): string[] {
    if (this._progress_points) {
      return this._progress_points;
    }
    let points: string[] = [];
    for (let selected in this._data) {
      for (let point in this._data[selected]) {
        if (points.indexOf(point) === -1) points.push(point);
      }
    }
    // Stable order.
    return this._progress_points = points.sort();
  }

/*  public getBadDataPoints(): ExperimentResult[] {
    let result = new Array<ExperimentResult>();
    for (let selected in this._data) {
      const selectedData = this._data[selected];
      const experimentResult: ExperimentResult = {
        name: selected,
        progress_points: []
      };
      for (let pp in selectedData) {
        const ppData = selectedData[pp];
        if (!ppData[0]) {
          continue;
        }
        const point: Point = {
          name: pp,
          measurements: []
        };
        for (let speedup in ppData) {
          const sData = ppData[+speedup];
          if (sData.type === 'throughput' && speedup !== '0') {
            const dataPoints = sData.points;
            for (const dataPoint of dataPoints) {

              dataPoint.duration;
            }
          }
        }
      }
    }
  }*/

  /**
   * Returns relevant speedup data given:
   * - The desired minimum number of points.
   * - The currently enabled progress points.
   */
  public getSpeedupData(min_points: number): ExperimentResult[] {
    const progress_points = this.getProgressPoints().filter((pp) => this._disabled_progress_points.indexOf(pp) === -1);
    let result: ExperimentResult[] = [];
    for (let selected in this._data) {
      let points: Point[] = [];
      let points_with_enough = 0;
      for (let i = 0; i < progress_points.length; i++) {
        // Set up an empty record for this progress point
        const point = {
          name: progress_points[i],
          measurements: new Array<Measurement>()
        };
        points.push(point);

        // Get the data for this progress point, if any
        let point_data = this._data[selected][progress_points[i]];

        // Check to be sure the point was observed and we have baseline (zero speedup) data
        if (point_data !== undefined && point_data[0] !== undefined) {
          // Loop over measurements and compute progress speedups in D3-friendly format
          let measurements: Measurement[] = [];
          for (let speedup in point_data) {
            const progress_speedup = point_data[speedup].speedup;
            // Skip really large negative and positive values
            if (progress_speedup.value >= -1 && progress_speedup.value <= 2) {
              // Add entry to measurements
              measurements.push({
                speedup: +speedup,
                progress_speedup: progress_speedup,
                num_points: point_data[speedup].points.length
              });
            }
          }

          // Sort measurements by speedup
          measurements.sort(function(a, b) { return a.speedup - b.speedup; });

          // Use these measurements if we have enough different points
          if (measurements.length >= min_points) {
            points_with_enough++;
            point.measurements = measurements;
          }
        }
      }

      if (points_with_enough > 0) {
        result.push({
          name: selected,
          progress_points: points
        });
      }
    }

    return result;
  }

  public drawLegend() {
    let container = this._plot_legend;
    const progress_points = this.getProgressPoints();
    let legend_entries_sel = container.selectAll('p.legend-entry').data(progress_points);
    // Remove defunct legend entries
    legend_entries_sel.exit().remove();
    legend_entries_sel = legend_entries_sel.enter()
        .append('p')
        .attr('class', 'legend-entry')
      .merge(legend_entries_sel);

    // Remove the noseries class from legend entries
    legend_entries_sel.classed('noseries', false).text('')
        .append('i')
        .attr('class', (d, i) => `fa fa-circle${this._disabled_progress_points.indexOf(d) !== -1 ? '-o' : ''} series${i % 4}`)
        .on('click', (d, i) => {
          const ind = this._disabled_progress_points.indexOf(d);
          if (ind !== -1) {
            // Re-enable.
            this._disabled_progress_points.splice(ind, 1);
          } else if (this._disabled_progress_points.length + 1 < progress_points.length) {
            // Disable.
            this._disabled_progress_points.push(d);
          } else {
            // This is the last enabled progress point. Forbid disabling it.
            this._display_warning("Warning", `At least one progress point must be enabled.`);
          }
          this.drawPlots(true);
          this.drawLegend();
        });
    legend_entries_sel.append('span')
      .attr('class', 'path')
      .text((d) => d);
  }

  public drawPlots(no_animate: boolean): void {
    const container = this._plot_container;
    const min_points = this._get_min_points();
    const speedup_data = this.getSpeedupData(min_points);

    /****** Compute y scale limits ******/
    let min_speedup = Infinity;
    let max_speedup = -Infinity;
    for (let i = 0; i < speedup_data.length; i++) {
      const result = speedup_data[i];
      const result_min = min_progress_speedup(result);
      const result_max = max_progress_speedup(result);
      if (result_min < min_speedup) {
        min_speedup = result_min;
      }
      if (result_max > max_speedup) {
        max_speedup = result_max;
      }
    }
    // Give some wiggle room to display points.
    min_speedup *= 1.05;
    max_speedup *= 1.05;

    /****** Compute dimensions ******/
    const container_width = parseInt(container.style('width'), 10);

    // Add columns while maintaining a target width
    let cols = 1;
    while (container_width / (cols + 1) >= 300) cols++;

    const div_width = container_width / cols;
    const div_height = 190;
    const svg_width = div_width - 10;
    const svg_height = div_height - 40;
    const margins = {left: 55, right: 20, top: 10, bottom: 35};
    const plot_width = svg_width - margins.left - margins.right;
    const plot_height = svg_height - margins.top - margins.bottom;
    const radius = 3;
    const tick_size = 6;

    // Formatters
    const axisFormat = d3.format('.0%');
    const percentFormat = d3.format('+.1%');

    // Scales
    let xscale = d3.scaleLinear().domain([0, 1]);
    let yscale = d3.scaleLinear().domain([min_speedup, max_speedup]);

    // Axes
    let xaxis = d3.axisBottom(xscale)
      .ticks(5)
      .tickFormat(axisFormat)
      .tickSizeOuter(tick_size);

    let yaxis = d3.axisLeft(yscale)
      .ticks(5)
      .tickFormat(axisFormat)
      .tickSizeOuter(tick_size);

    // Tooltip
    let tip = d3.tip()
      .attr('class', 'd3-tip')
      .offset([-5, 0])
      .html(function (d: Measurement) {
        return `<strong>Line Speedup:</strong> ${percentFormat(d.speedup)}<br>
                <strong>Progress Speedup:</strong> ${percentFormat(d.progress_speedup.value)}<br>
                <strong>95% Confidence:</strong> (${percentFormat(d.progress_speedup.conf_left)}, ${percentFormat(d.progress_speedup.conf_right)})<br>
                <strong>Data Points:</strong> ${d.num_points}`;
      })
      .direction(function (d: Measurement) {
        // Fast west if near top or right of graph.
        if (d.speedup > 0.8 || yscale(d.progress_speedup.value) < (yscale(0.8 * (min_speedup + (max_speedup - min_speedup) / 2)))) return 'w';
        else return 'n';
      });

    /****** Add or update divs to hold each plot ******/
    let plot_div_sel = container.selectAll<any, ExperimentResult>('div.plot')
      .data(speedup_data, (d) => d.name);

    function plot_x_pos(d: any, i: number) {
      let col = i % cols;
      return (col * div_width) + 'px';
    }

    function plot_y_pos(d: any, i: number) {
      let row = (i - (i % cols)) / cols;
      return (row * div_height) + 'px';
    }

    // First, remove divs that are disappearing
    plot_div_sel.exit().transition().duration(200)
      .style('opacity', 0).remove();

    // Insert new divs with zero opacity
    plot_div_sel = plot_div_sel.enter()
        .append('div')
        .attr('class', 'plot')
        .style('margin-bottom', -div_height+'px')
        .style('opacity', 0)
        .style('width', div_width)
      .merge(plot_div_sel);

    // Sort remaining plots by the chosen sorting function
    plot_div_sel = plot_div_sel.sort(sort_functions[(d3.select<HTMLInputElement, null>('#sortby_field').node()).value]);

    // Move divs into place. Only animate if we are not on a resizing redraw
    if (!no_animate) {
      plot_div_sel.transition().duration(400).delay(200)
        .style('top', plot_y_pos)
        .style('left', plot_x_pos)
        .style('opacity', 1);
    } else {
      plot_div_sel.style('left', plot_x_pos)
                  .style('top', plot_y_pos);
    }

    /****** Insert, remove, and update plot titles ******/
    let plot_title_sel = plot_div_sel.selectAll('div.plot-title')
      .data((d) => [formatTitle(d.name)]);
    plot_title_sel.exit().remove();
    plot_title_sel = plot_title_sel.enter().append('div')
          .attr('class', 'plot-title')
        .merge(plot_title_sel)
          .text((d) => d)
          .classed('path', true)
          .style('width', div_width+'px');

    /****** Update scales ******/
    xscale = xscale.domain([0, 1]).range([0, plot_width]);
    yscale = yscale.domain([min_speedup, max_speedup]).range([plot_height, 0]);

    /****** Update gridlines ******/
    xaxis = xaxis.tickSizeInner(-plot_height);
    yaxis = yaxis.tickSizeInner(-plot_width);

    /****** Insert and update plot svgs ******/
    let plot_svg_sel = plot_div_sel.selectAll('svg').data([1]);
    plot_svg_sel.exit().remove();
    plot_svg_sel = plot_svg_sel.enter()
                  .append('svg')
                .merge(plot_svg_sel)
                  .attr('width', svg_width)
                  .attr('height', svg_height)
                  .call(<any> tip);

    /****** Add or update plot areas ******/
    let plot_area_sel = plot_svg_sel.selectAll('g.plot_area').data([0]);
    plot_area_sel.exit().remove();
    plot_area_sel = plot_area_sel.enter()
                  .append('g')
                  .attr('class', 'plot_area')
                .merge(plot_area_sel)
                  .attr('transform', `translate(${margins.left}, ${margins.top})`);

    /****** Add or update clip paths ******/
    let clippath_sel = plot_area_sel.selectAll('#clip').data([0]);
    clippath_sel.exit().remove();
    clippath_sel = clippath_sel.enter().append('clipPath').attr('id', 'clip').merge(clippath_sel);

    /****** Add or update clipping rectangles to clip paths ******/
    let clip_rect_sel = clippath_sel.selectAll('rect').data([0]);
    clip_rect_sel.exit().remove();
    clip_rect_sel = clip_rect_sel.enter()
                      .append('rect')
                    .merge(clip_rect_sel)
                      .attr('x', -radius - 1)
                      .attr('y', 0)
                      .attr('width', plot_width + 2 * radius + 2)
                      .attr('height', plot_height);

    /****** Select plots areas, but preserve the real speedup data ******/
    let plot_area_sel_speedup = plot_div_sel.select('svg').select('g.plot_area');

    /****** Add or update x-axes ******/
    let xaxis_sel = plot_area_sel_speedup.selectAll('g.xaxis').data([0]);
    xaxis_sel.exit().remove();
    xaxis_sel = xaxis_sel.enter()
                    .append('g')
                    .attr('class', 'xaxis')
                  .merge(xaxis_sel)
                    .attr('transform', `translate(0, ${plot_height})`)
                    .call(xaxis);

    /****** Add or update x-axis titles ******/
    let xtitle_sel = plot_area_sel_speedup.selectAll('text.xtitle').data([0]);
    xtitle_sel.exit().remove();
    xtitle_sel = xtitle_sel.enter()
                    .append('text')
                    .attr('class', 'xtitle')
                  .merge(xtitle_sel)
                    .attr('x', xscale(0.5))
                    .attr('y', 32) // Approximate height of the x-axis
                    .attr('transform', `translate(0, ${plot_height})`)
                    .style('text-anchor', 'middle')
                    .text('Line speedup');

    /****** Add or update y-axes ******/
    let yaxis_sel = plot_area_sel_speedup.selectAll('g.yaxis').data([0]);
    yaxis_sel.exit().remove();
    yaxis_sel = yaxis_sel.enter()
                    .append('g')
                    .attr('class', 'yaxis')
                  .merge(yaxis_sel)
                    .call(yaxis);

    /****** Add or update y-axis title ******/
    let ytitle_sel = plot_area_sel_speedup.selectAll('text.ytitle').data([0]);
    ytitle_sel.exit().remove();
    ytitle_sel = ytitle_sel.enter()
                    .append('text')
                    .attr('class', 'ytitle')
                  .merge(ytitle_sel)
                    .attr('x', -yscale(min_speedup + (max_speedup - min_speedup) / 2)) // x and y are flipped because of rotation
                    .attr('y', -40) // Approximate width of y-axis
                    .attr('transform', 'rotate(-90)')
                    .style('text-anchor', 'middle')
                    .style('alignment-baseline', 'central')
                    .text('Program Speedup');

    /****** Add or update x-zero line ******/
    let xzero_sel = plot_area_sel_speedup.selectAll('line.xzero').data([0]);
    xzero_sel.exit().remove();
    xzero_sel = xzero_sel.enter()
                    .append('line')
                    .attr('class', 'xzero')
                  .merge(xzero_sel)
                    .attr('x1', xscale(0))
                    .attr('y1', 0)
                    .attr('x2', xscale(0))
                    .attr('y2', plot_height + tick_size);

    /****** Add or update y-zero line ******/
    let yzero_sel = plot_area_sel_speedup.selectAll('line.yzero').data([0]);
    yzero_sel.exit().remove();
    yzero_sel = yzero_sel.enter()
                    .append('line')
                    .attr('class', 'yzero')
                  .merge(yzero_sel)
                    .attr('x1', -tick_size)
                    .attr('y1', yscale(0))
                    .attr('x2', plot_width)
                    .attr('y2', yscale(0));

    /****** Add or update series ******/
    let progress_points = this.getProgressPoints();
    let series_sel = plot_area_sel_speedup.selectAll('g.series')
      .data((d) => d.progress_points, (d) => (<Point> d).name);
    series_sel.exit().remove();
    series_sel = series_sel.enter()
                    .append('g')
                    .attr('class', 'series')
                  .merge(series_sel)
                    .attr('class', (d, k) =>
                      // Use progress point's position in array to assign it a stable color, no matter
                      // which points are enabled for display.
                      `series series${(progress_points.indexOf(d.name)) % 5}`)
                    .attr('style', 'clip-path: url(#clip);');

    /****** Add or update trendlines ******/
    // Configure a loess smoother
    let loess = science.stats.loess()
      .bandwidth(0.4)
      .robustnessIterations(5);

    // Create an svg line to draw the loess curve
    let line = d3.line()
                .x((d) => xscale(d[0]))
                .y((d) => yscale(d[1]))
                .curve(d3.curveBasis);

    // Apply the loess smoothing to each series, then draw the lines
    let lines_sel = series_sel.selectAll('path.line').data(function(d) {
      let xvals = d.measurements.map((e) => e.speedup);
      let yvals = d.measurements.map((e) => e.progress_speedup.value);
      let smoothed_y: number[] = [];
      try {
        smoothed_y = loess(xvals, yvals);
      } catch (e) {
        // Bandwidth too small error. Ignore and proceed with empty smoothed line.
      }
      // Speedup is always zero for a line speedup of zero
      smoothed_y[0] = 0;
      // smoothed_y sometimes has NaN, which throws things off.
      if (xvals.length > 5 && smoothed_y.filter((y) => isNaN(y)).length === 0) return [d3.zip(xvals, smoothed_y)];
      else return [d3.zip(xvals, yvals)];
    });
    lines_sel.exit().remove();
    lines_sel = lines_sel.enter()
                    .append('path')
                    .attr('class', 'line')
                  .merge(lines_sel)
                    // Update outside of enter() so the line gets re-drawn, in case scales change.
                    .attr('d', line);

    /****** Add or update error bars ******/

    function pointMouseover(d: Measurement, i: number): void {
      d3.select(this).classed('highlight', true);
      tip.show(d, i);
    }
    function pointMouseout(d: Measurement, i: number): void {
      d3.select(this).classed('highlight', false);
      tip.hide(d, i);
    }

    let error_bars_sel = series_sel.selectAll('path.error-bar').data((d) => d.measurements);
    error_bars_sel.exit().remove();
    error_bars_sel = error_bars_sel.enter()
        .append('path')
        .attr('class', 'error-bar')
        .on('mouseover', pointMouseover)
        .on('mouseout', pointMouseout)
      .merge(error_bars_sel)
        .attr('d', (d) => {
          const cx = d.speedup;
          const conf_left = d.progress_speedup.conf_left;
          const conf_right = d.progress_speedup.conf_right;
          // Error bar. Draw the vertical line first, then the bottom horizontal line, then the top horizontal
          // line.
          // See https://codepen.io/AmeliaBR/full/pIder for details on SVG paths.
          // TODO: Convert to D3 instead.
          return `M${xscale(cx)},${yscale(conf_right)} L${xscale(cx)},${yscale(conf_left)} m${-radius},0 l${2*radius},0 M${xscale(cx) + 3},${yscale(conf_right)} l${-2*radius},0`;
        });

    /****** Add or update points ******/
    let points_sel = series_sel.selectAll('circle').data((d) => d.measurements);
    points_sel.exit().remove();
    points_sel = points_sel.enter()
        .append('circle')
        .on('mouseover', pointMouseover)
        .on('mouseout', pointMouseout)
      .merge(points_sel)
        .attr('r', radius)
        .attr('cx', (d) => xscale(d.speedup))
        .attr('cy', (d) => yscale(d.progress_speedup.value));
  }
}

Profile.initializeWorker();
