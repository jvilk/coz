(function (_d3) {
'use strict';

/**
 * Hack to work around broken d3-tip typings.
 */
var d3 = _d3;

function IDENTITY(d) {
    return d;
}
/**
 * Formats the title of a graph.
 * Removes everything but the script in URLs so that function names appear.
 * Also strips out ? parameters from URL.
 */
function formatTitle(t) {
    var lastSlash = t.lastIndexOf('/') + 1;
    if (lastSlash === -1) {
        lastSlash = 0;
    }
    var cutoff = t.indexOf('?', lastSlash);
    if (cutoff === -1) {
        cutoff = t.indexOf(' ', lastSlash);
    }
    return t.slice(lastSlash, cutoff) + " " + t.slice(t.indexOf(' ', cutoff));
}
function get_average_value(m) {
    return m.progress_speedup.value;
}
function get_lowest_95conf_value(m) {
    return m.progress_speedup.conf_left;
}
function max_normalized_area(d, get_value) {
    var max_normalized_area = 0;
    for (var _i = 0, _a = d.progress_points; _i < _a.length; _i++) {
        var point = _a[_i];
        var area = 0;
        var prev_data = point.measurements[0];
        for (var _b = 0, _c = point.measurements; _b < _c.length; _b++) {
            var current_data = _c[_b];
            var avg_progress_speedup = (get_value(prev_data) + get_value(current_data)) / 2;
            area += avg_progress_speedup * (current_data.speedup - prev_data.speedup);
            var normalized_area = area / current_data.speedup;
            if (normalized_area > max_normalized_area)
                { max_normalized_area = normalized_area; }
            prev_data = current_data;
        }
    }
    return max_normalized_area;
}
function max_progress_speedup(d) {
    var max_progress_speedup = 0;
    for (var _i = 0, _a = d.progress_points; _i < _a.length; _i++) {
        var point = _a[_i];
        for (var _b = 0, _c = point.measurements; _b < _c.length; _b++) {
            var measurement = _c[_b];
            var progress_speedup = measurement.progress_speedup.value;
            if (progress_speedup > max_progress_speedup)
                { max_progress_speedup = progress_speedup; }
        }
    }
    return max_progress_speedup;
}
function min_progress_speedup(d) {
    var min_progress_speedup = 0;
    for (var _i = 0, _a = d.progress_points; _i < _a.length; _i++) {
        var point = _a[_i];
        for (var _b = 0, _c = point.measurements; _b < _c.length; _b++) {
            var measurement = _c[_b];
            var progress_speedup = measurement.progress_speedup.value;
            if (progress_speedup < min_progress_speedup)
                { min_progress_speedup = progress_speedup; }
        }
    }
    return min_progress_speedup;
}
var sort_functions = {
    alphabetical: function (a, b) {
        if (a.name > b.name)
            { return 1; }
        else
            { return -1; }
    },
    impact: function (a, b) {
        if (max_normalized_area(b, get_average_value) > max_normalized_area(a, get_average_value))
            { return 1; }
        else
            { return -1; }
    },
    pessimal_impact: function (a, b) {
        if (max_normalized_area(b, get_lowest_95conf_value) > max_normalized_area(a, get_lowest_95conf_value))
            { return 1; }
        else
            { return -1; }
    },
    max_speedup: function (a, b) {
        if (max_progress_speedup(b) > max_progress_speedup(a))
            { return 1; }
        else
            { return -1; }
    },
    min_speedup: function (a, b) {
        if (min_progress_speedup(a) > min_progress_speedup(b))
            { return 1; }
        else
            { return -1; }
    }
};
function hideHideButtons() {
    // Hide all hide buttons.
    $('.hide-btn').css('display', 'none');
    // Remove blur.
    $('.plot > svg').css('filter', 'none');
}
var Profile = (function () {
    function Profile(data, container, legend, get_min_points, display_warning) {
        this._data = null;
        this._disabled_progress_points = [];
        this._progress_points = null;
        // Program fragments that should not be plotted.
        this._hidden_plots = {};
        this._data = data;
        this._plot_container = container;
        this._plot_legend = legend;
        this._get_min_points = get_min_points;
        this._display_warning = display_warning;
    }
    Profile.initializeWorker = function () {
        if (!Profile.worker) {
            Profile.worker = new Worker('./build/worker.js');
            Profile.worker.addEventListener('message', function (e) {
                var data = e.data;
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
    };
    Profile.sendMessage = function (m) {
        Profile.worker.postMessage(m);
    };
    Profile.createProfile = function (files, container, legend, get_min_points, display_warning, cb, progress) {
        Profile._onProfileReceived = function (m) {
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
    };
    Profile.prototype.getProgressPoints = function () {
        var this$1 = this;

        if (this._progress_points) {
            return this._progress_points;
        }
        var points = [];
        for (var selected in this$1._data) {
            for (var point in this$1._data[selected]) {
                if (points.indexOf(point) === -1)
                    { points.push(point); }
            }
        }
        // Stable order.
        return this._progress_points = points.sort();
    };
    Profile.prototype.getHiddenPlots = function () {
        return Object.keys(this._hidden_plots).sort();
    };
    Profile.prototype.hidePlot = function (program_fragment) {
        this._hidden_plots[program_fragment] = true;
    };
    Profile.prototype.unhidePlot = function (program_fragment) {
        delete this._hidden_plots[program_fragment];
    };
    /**
     * Returns relevant speedup data given:
     * - The desired minimum number of points.
     * - The currently enabled progress points.
     * - The currently ignored functions / lines.
     */
    Profile.prototype.getSpeedupData = function (min_points) {
        var this$1 = this;

        var _this = this;
        var progress_points = this.getProgressPoints().filter(function (pp) { return _this._disabled_progress_points.indexOf(pp) === -1; });
        var result = [];
        for (var selected in this$1._data) {
            if (this$1._hidden_plots[selected]) {
                continue;
            }
            var points = [];
            var points_with_enough = 0;
            for (var i = 0; i < progress_points.length; i++) {
                // Set up an empty record for this progress point
                var point = {
                    name: progress_points[i],
                    measurements: new Array()
                };
                points.push(point);
                // Get the data for this progress point, if any
                var point_data = this$1._data[selected][progress_points[i]];
                // Check to be sure the point was observed and we have baseline (zero speedup) data
                if (point_data !== undefined && point_data[0] !== undefined) {
                    // Loop over measurements and compute progress speedups in D3-friendly format
                    var measurements = [];
                    for (var speedup in point_data) {
                        var progress_speedup = point_data[speedup].speedup;
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
                    measurements.sort(function (a, b) { return a.speedup - b.speedup; });
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
    };
    Profile.prototype.drawLegend = function () {
        var _this = this;
        var container = this._plot_legend;
        var progress_points = this.getProgressPoints();
        var legend_entries_sel = container.selectAll('p.legend-entry').data(progress_points);
        // Remove defunct legend entries
        legend_entries_sel.exit().remove();
        legend_entries_sel = legend_entries_sel.enter()
            .append('p')
            .attr('class', 'legend-entry')
            .merge(legend_entries_sel);
        // Remove the noseries class from legend entries
        legend_entries_sel.classed('noseries', false).text('')
            .append('i')
            .attr('class', function (d, i) { return "fa fa-circle" + (_this._disabled_progress_points.indexOf(d) !== -1 ? '-o' : '') + " series" + i % 4; })
            .on('click', function (d, i) {
            var ind = _this._disabled_progress_points.indexOf(d);
            if (ind !== -1) {
                // Re-enable.
                _this._disabled_progress_points.splice(ind, 1);
            }
            else if (_this._disabled_progress_points.length + 1 < progress_points.length) {
                // Disable.
                _this._disabled_progress_points.push(d);
            }
            else {
                // This is the last enabled progress point. Forbid disabling it.
                _this._display_warning("Warning", "At least one progress point must be enabled.");
            }
            _this.drawPlots(true);
            _this.drawLegend();
        });
        legend_entries_sel.append('span')
            .attr('class', 'path')
            .text(IDENTITY);
        var hidden_plots = this.getHiddenPlots();
        var hidden_plots_select = d3.select('#hidden_plots_select');
        var hidden_plots_list = hidden_plots_select.selectAll('option').data(hidden_plots);
        //.data(hidden_plots);
        hidden_plots_list.exit().remove();
        hidden_plots_list.enter()
            .append('option')
            .text(IDENTITY)
            .merge(hidden_plots_list);
        var hidden_plots_btn = d3.select('#hidden_plots_btn');
        if (hidden_plots.length === 0) {
            hidden_plots_btn.attr('disabled', 'disabled');
            hidden_plots_select.attr('disabled', 'disabled');
        }
        else {
            hidden_plots_btn.attr('disabled', null);
            hidden_plots_select.attr('disabled', null);
        }
    };
    Profile.prototype.drawPlots = function (no_animate) {
        var profile = this;
        var container = this._plot_container;
        var min_points = this._get_min_points();
        var speedup_data = this.getSpeedupData(min_points);
        /****** Compute y scale limits ******/
        var min_speedup = Infinity;
        var max_speedup = -Infinity;
        for (var i = 0; i < speedup_data.length; i++) {
            var result = speedup_data[i];
            var result_min = min_progress_speedup(result);
            var result_max = max_progress_speedup(result);
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
        var container_width = parseInt(container.style('width'), 10);
        // Add columns while maintaining a target width
        var cols = 1;
        while (container_width / (cols + 1) >= 300)
            { cols++; }
        var div_width = container_width / cols;
        var div_height = 190;
        var svg_width = div_width - 10;
        var svg_height = div_height - 40;
        var margins = { left: 55, right: 20, top: 10, bottom: 35 };
        var plot_width = svg_width - margins.left - margins.right;
        var plot_height = svg_height - margins.top - margins.bottom;
        var radius = 3;
        var tick_size = 6;
        // Formatters
        var axisFormat = d3.format('.0%');
        var percentFormat = d3.format('+.1%');
        // Scales
        var xscale = d3.scaleLinear().domain([0, 1]);
        var yscale = d3.scaleLinear().domain([min_speedup, max_speedup]);
        // Axes
        var xaxis = d3.axisBottom(xscale)
            .ticks(5)
            .tickFormat(axisFormat)
            .tickSizeOuter(tick_size);
        var yaxis = d3.axisLeft(yscale)
            .ticks(5)
            .tickFormat(axisFormat)
            .tickSizeOuter(tick_size);
        // Tooltip
        var tip = d3.tip()
            .attr('class', 'd3-tip')
            .offset([-5, 0])
            .html(function (d) {
            return "<strong>Line Speedup:</strong> " + percentFormat(d.speedup) + "<br>\n                <strong>Progress Speedup:</strong> " + percentFormat(d.progress_speedup.value) + "<br>\n                <strong>95% Confidence:</strong> (" + percentFormat(d.progress_speedup.conf_left) + ", " + percentFormat(d.progress_speedup.conf_right) + ")<br>\n                <strong>Data Points:</strong> " + d.num_points;
        })
            .direction(function (d) {
            // Fast west if near top or right of graph.
            if (d.speedup > 0.8 || yscale(d.progress_speedup.value) < (yscale(0.8 * (min_speedup + (max_speedup - min_speedup) / 2))))
                { return 'w'; }
            else
                { return 'n'; }
        });
        /****** Add or update divs to hold each plot ******/
        var plot_div_sel = container.selectAll('div.plot')
            .data(speedup_data, function (d) { return d.name; });
        function plot_x_pos(d, i) {
            var col = i % cols;
            return (col * div_width) + 'px';
        }
        function plot_y_pos(d, i) {
            var row = (i - (i % cols)) / cols;
            return (row * div_height) + 'px';
        }
        // First, remove divs that are disappearing
        plot_div_sel.exit().transition().duration(200)
            .style('opacity', 0).remove();
        hideHideButtons();
        // Insert new divs with zero opacity
        plot_div_sel = plot_div_sel.enter()
            .append('div')
            .attr('class', 'plot')
            .style('margin-bottom', -div_height + 'px')
            .style('opacity', 0)
            .style('width', div_width)
            .each(function (d) {
            d3.select(this)
                .append('button')
                .attr('type', 'button')
                .attr('class', 'btn btn-primary hide-btn')
                .style('position', 'absolute')
                .style('display', 'none')
                .style('z-index', '10')
                .text('Hide Plot')
                .on('click', function () {
                var self = this;
                var parent = d3.select(self.parentNode);
                var data = parent.datum();
                profile.hidePlot(data.name);
                profile.drawPlots(false);
                profile.drawLegend();
            });
        })
            .on('click', function (d) {
            var self = $(this);
            var svg = self.children('svg');
            var isSelected = svg.css('filter') !== 'none';
            hideHideButtons();
            // Clicking a selected plot will just unselect it.
            if (!isSelected) {
                // Show + center the button
                var btn = self.children('.hide-btn');
                btn.css('display', 'inline')
                    .css('left', (self.width() / 2) - (btn.width() / 2) + 'px')
                    .css('top', (self.height() / 2) - (btn.height() / 2) + 'px');
                // Blur the plot
                svg.css('filter', 'blur(5px)');
            }
        })
            .merge(plot_div_sel);
        // Sort remaining plots by the chosen sorting function
        plot_div_sel = plot_div_sel.sort(sort_functions[(d3.select('#sortby_field').node()).value]);
        // Move divs into place. Only animate if we are not on a resizing redraw
        if (!no_animate) {
            plot_div_sel.transition().duration(400).delay(200)
                .style('top', plot_y_pos)
                .style('left', plot_x_pos)
                .style('opacity', 1);
        }
        else {
            plot_div_sel.style('left', plot_x_pos)
                .style('top', plot_y_pos);
        }
        /****** Insert, remove, and update plot titles ******/
        var plot_title_sel = plot_div_sel.selectAll('div.plot-title')
            .data(function (d) { return [formatTitle(d.name)]; });
        plot_title_sel.exit().remove();
        plot_title_sel = plot_title_sel.enter().append('div')
            .attr('class', 'plot-title')
            .merge(plot_title_sel)
            .text(IDENTITY)
            .classed('path', true)
            .style('width', div_width + 'px');
        /****** Update scales ******/
        xscale = xscale.domain([0, 1]).range([0, plot_width]);
        yscale = yscale.domain([min_speedup, max_speedup]).range([plot_height, 0]);
        /****** Update gridlines ******/
        xaxis = xaxis.tickSizeInner(-plot_height);
        yaxis = yaxis.tickSizeInner(-plot_width);
        /****** Insert and update plot svgs ******/
        var plot_svg_sel = plot_div_sel.selectAll('svg').data([1]);
        plot_svg_sel.exit().remove();
        plot_svg_sel = plot_svg_sel.enter()
            .append('svg')
            .merge(plot_svg_sel)
            .attr('width', svg_width)
            .attr('height', svg_height)
            .call(tip);
        /****** Add or update plot areas ******/
        var plot_area_sel = plot_svg_sel.selectAll('g.plot_area').data([0]);
        plot_area_sel.exit().remove();
        plot_area_sel = plot_area_sel.enter()
            .append('g')
            .attr('class', 'plot_area')
            .merge(plot_area_sel)
            .attr('transform', "translate(" + margins.left + ", " + margins.top + ")");
        /****** Add or update clip paths ******/
        var clippath_sel = plot_area_sel.selectAll('#clip').data([0]);
        clippath_sel.exit().remove();
        clippath_sel = clippath_sel.enter().append('clipPath').attr('id', 'clip').merge(clippath_sel);
        /****** Add or update clipping rectangles to clip paths ******/
        var clip_rect_sel = clippath_sel.selectAll('rect').data([0]);
        clip_rect_sel.exit().remove();
        clip_rect_sel = clip_rect_sel.enter()
            .append('rect')
            .merge(clip_rect_sel)
            .attr('x', -radius - 1)
            .attr('y', 0)
            .attr('width', plot_width + 2 * radius + 2)
            .attr('height', plot_height);
        /****** Select plots areas, but preserve the real speedup data ******/
        var plot_area_sel_speedup = plot_div_sel.select('svg').select('g.plot_area');
        /****** Add or update x-axes ******/
        var xaxis_sel = plot_area_sel_speedup.selectAll('g.xaxis').data([0]);
        xaxis_sel.exit().remove();
        xaxis_sel = xaxis_sel.enter()
            .append('g')
            .attr('class', 'xaxis')
            .merge(xaxis_sel)
            .attr('transform', "translate(0, " + plot_height + ")")
            .call(xaxis);
        /****** Add or update x-axis titles ******/
        var xtitle_sel = plot_area_sel_speedup.selectAll('text.xtitle').data([0]);
        xtitle_sel.exit().remove();
        xtitle_sel = xtitle_sel.enter()
            .append('text')
            .attr('class', 'xtitle')
            .merge(xtitle_sel)
            .attr('x', xscale(0.5))
            .attr('y', 32) // Approximate height of the x-axis
            .attr('transform', "translate(0, " + plot_height + ")")
            .style('text-anchor', 'middle')
            .text('Line speedup');
        /****** Add or update y-axes ******/
        var yaxis_sel = plot_area_sel_speedup.selectAll('g.yaxis').data([0]);
        yaxis_sel.exit().remove();
        yaxis_sel = yaxis_sel.enter()
            .append('g')
            .attr('class', 'yaxis')
            .merge(yaxis_sel)
            .call(yaxis);
        /****** Add or update y-axis title ******/
        var ytitle_sel = plot_area_sel_speedup.selectAll('text.ytitle').data([0]);
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
        var xzero_sel = plot_area_sel_speedup.selectAll('line.xzero').data([0]);
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
        var yzero_sel = plot_area_sel_speedup.selectAll('line.yzero').data([0]);
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
        var progress_points = this.getProgressPoints();
        var series_sel = plot_area_sel_speedup.selectAll('g.series')
            .data(function (d) { return d.progress_points; }, function (d) { return d.name; });
        series_sel.exit().remove();
        series_sel = series_sel.enter()
            .append('g')
            .attr('class', 'series')
            .merge(series_sel)
            .attr('class', function (d, k) {
            // Use progress point's position in array to assign it a stable color, no matter
            // which points are enabled for display.
            return "series series" + (progress_points.indexOf(d.name)) % 5;
        })
            .attr('style', 'clip-path: url(#clip);');
        /****** Add or update trendlines ******/
        // Configure a loess smoother
        var loess = science.stats.loess()
            .bandwidth(0.4)
            .robustnessIterations(5);
        // Create an svg line to draw the loess curve
        var line = d3.line()
            .x(function (d) { return xscale(d[0]); })
            .y(function (d) { return yscale(d[1]); })
            .curve(d3.curveBasis);
        // Apply the loess smoothing to each series, then draw the lines
        var lines_sel = series_sel.selectAll('path.line').data(function (d) {
            var xvals = d.measurements.map(function (e) { return e.speedup; });
            var yvals = d.measurements.map(function (e) { return e.progress_speedup.value; });
            var smoothed_y = [];
            try {
                smoothed_y = loess(xvals, yvals);
            }
            catch (e) {
                // Bandwidth too small error. Ignore and proceed with empty smoothed line.
            }
            // Speedup is always zero for a line speedup of zero
            smoothed_y[0] = 0;
            // smoothed_y sometimes has NaN, which throws things off.
            if (xvals.length > 5 && smoothed_y.filter(function (y) { return isNaN(y); }).length === 0)
                { return [d3.zip(xvals, smoothed_y)]; }
            else
                { return [d3.zip(xvals, yvals)]; }
        });
        lines_sel.exit().remove();
        lines_sel = lines_sel.enter()
            .append('path')
            .attr('class', 'line')
            .merge(lines_sel)
            .attr('d', line);
        /****** Add or update error bars ******/
        function pointMouseover(d, i) {
            d3.select(this).classed('highlight', true);
            tip.show(d, i);
        }
        function pointMouseout(d, i) {
            d3.select(this).classed('highlight', false);
            tip.hide(d, i);
        }
        var error_bars_sel = series_sel.selectAll('path.error-bar').data(function (d) { return d.measurements; });
        error_bars_sel.exit().remove();
        error_bars_sel = error_bars_sel.enter()
            .append('path')
            .attr('class', 'error-bar')
            .on('mouseover', pointMouseover)
            .on('mouseout', pointMouseout)
            .merge(error_bars_sel)
            .attr('d', function (d) {
            var cx = d.speedup;
            var conf_left = d.progress_speedup.conf_left;
            var conf_right = d.progress_speedup.conf_right;
            // Error bar. Draw the vertical line first, then the bottom horizontal line, then the top horizontal
            // line.
            // See https://codepen.io/AmeliaBR/full/pIder for details on SVG paths.
            // TODO: Convert to D3 instead.
            return "M" + xscale(cx) + "," + yscale(conf_right) + " L" + xscale(cx) + "," + yscale(conf_left) + " m" + -radius + ",0 l" + 2 * radius + ",0 M" + (xscale(cx) + 3) + "," + yscale(conf_right) + " l" + -2 * radius + ",0";
        });
        /****** Add or update points ******/
        var points_sel = series_sel.selectAll('circle').data(function (d) { return d.measurements; });
        points_sel.exit().remove();
        points_sel = points_sel.enter()
            .append('circle')
            .on('mouseover', pointMouseover)
            .on('mouseout', pointMouseout)
            .merge(points_sel)
            .attr('r', radius)
            .attr('cx', function (d) { return xscale(d.speedup); })
            .attr('cy', function (d) { return yscale(d.progress_speedup.value); });
    };
    return Profile;
}());
Profile._onProfileReceived = null;
Profile._onProgress = null;
Profile.initializeWorker();

// Ensure the brower supports the File API
if (!window.File || !window.FileReader) {
    alert('The File APIs are not fully supported in this browser.');
}
var current_profile = undefined;
function get_min_points() {
    return +d3.select('#minpoints_field').node().value;
}
function display_warning(title, text) {
    var warning = $("<div class=\"alert alert-warning alert-dismissible\" role=\"alert\">\n      <button type=\"button\" class=\"close\" data-dismiss=\"alert\" aria-label=\"Close\"><span aria-hidden=\"true\">&times;</span></button>\n      <strong>" + title + ":</strong> " + text + "\n    </div>");
    $('#warning-area').append(warning);
    // Fade out after 5 seconds.
    setTimeout(function () {
        warning.fadeOut(500, function () {
            warning.alert('close');
        });
    }, 5000);
}
function create_profile(files, cb) {
    var bar = $('#profile-loading-bar').attr('aria-valuenow', '0');
    var modal = $('#profile-loading-dlg').modal('show');
    Profile.createProfile(files, d3.select('#plot-area'), d3.select('#legend'), get_min_points, display_warning, function (e, p) {
        modal.modal('hide');
        if (e) {
            display_warning("Error", "Could not parse profile: " + e.msg + "<br />" + e.stack);
        }
        else {
            cb(p);
        }
    }, function (p) {
        bar.css('width', p.percent + "%")
            .text("[" + p.percent + "%] " + p.msg);
    });
}
function update(resize) {
    if (current_profile === undefined)
        { return; }
    // Enable the sortby field
    d3.select('#sortby_field').attr('disabled', null);
    // Draw the legend
    current_profile.drawLegend();
    // Draw plots
    current_profile.drawPlots(resize);
    var tooltip = d3.select("body")
        .append("div")
        .style("position", "absolute")
        .style("z-index", "10")
        .style("visibility", "hidden");
    // Shorten path strings
    var paths = d3.selectAll('.path')
        .classed('path', false)
        .classed('shortpath', true)
        .text(function (d) {
        var parts = d.split('/');
        var filename = parts[parts.length - 1];
        return filename;
    });
}
// Set a handler for the load profile button
d3.select('#load-profile-btn').on('click', function () {
    // Reset the filename field
    d3.select('#load-profile-filename').attr('value', '');
    // Disable the open button
    d3.select('#load-profile-open-btn').classed('disabled', true);
});
// Set a handler for the fake browse button
d3.select('#load-profile-browse-btn').on('click', function () {
    $('#load-profile-file').trigger('click');
});
// Set a handler for file selection
d3.select('#load-profile-file').on('change', function () {
    var file_browser = this;
    var open_button = d3.select('#load-profile-open-btn');
    d3.select('#load-profile-filename').attr('value', file_browser.value.replace(/C:\\fakepath\\/i, ''));
    open_button.classed('disabled', false)
        .on('click', function () {
        var files = [];
        var fileList = file_browser.files;
        for (var i = 0; i < fileList.length; i++) {
            files.push(fileList[i]);
        }
        create_profile(files, function (p) {
            current_profile = p;
            update();
        });
        // Clear the file browser value
        file_browser.value = '';
    });
});
// Update the plots and minpoints display when dragged or clicked
d3.select('#minpoints_field').on('input', function () {
    d3.select('#minpoints_display').text(this.value);
    update();
});
// Unhide plots selected in left menu.
d3.select('#hidden_plots_btn').on('click', function () {
    if (!current_profile) {
        return;
    }
    var options = d3.selectAll('#hidden_plots_select > option').nodes();
    var redraw = false;
    for (var _i = 0, options_1 = options; _i < options_1.length; _i++) {
        var option = options_1[_i];
        if (option.selected) {
            redraw = true;
            current_profile.unhidePlot(option.innerText);
        }
    }
    if (redraw) {
        update();
    }
});
d3.select('#sortby_field').on('change', update);
d3.select(window).on('resize', function () { update(true); });
var sample_profiles = ['blackscholes', 'dedup', 'ferret', 'fluidanimate', 'sqlite', 'swaptions'];
var sample_profile_objects = {};
var samples_sel = d3.select('#samples').selectAll('.sample-profile').data(sample_profiles)
    .enter().append('button')
    .attr('class', 'btn btn-sm btn-default sample-profile')
    .attr('data-dismiss', 'modal')
    .attr('loaded', 'no')
    .text(function (d) { return d; })
    .on('click', function (d) {
    var sel = d3.select(this);
    if (sel.attr('loaded') !== 'yes') {
        // Avoid race condition: Set first.
        sel.attr('loaded', 'yes');
        var xhr_1 = new XMLHttpRequest();
        xhr_1.open('GET', "profiles/" + d + ".coz");
        xhr_1.responseType = 'arraybuffer';
        xhr_1.onload = function () {
            create_profile([new Blob([xhr_1.response])], function (p) {
                current_profile = sample_profile_objects[d] = p;
                update();
            });
        };
        xhr_1.onerror = function () {
            sel.attr('loaded', 'no');
            display_warning("Error", "Failed to load profile for " + d + ".");
        };
        xhr_1.send();
    }
    else {
        current_profile = sample_profile_objects[d];
        update();
    }
});

}(d3));
//# sourceMappingURL=ui.js.map
