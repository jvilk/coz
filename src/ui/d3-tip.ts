/**
 * Hack to work around broken d3-tip typings.
 */
import * as _d3 from 'd3';
export type TooltipDirection = ("n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se");
export interface Tooltip {
  hide<Datum>(data: Datum, i: number): Tooltip;
  show(): Tooltip;
  show<Datum>(data: Datum[]): Tooltip;
  show(target: SVGElement): Tooltip;
  show<Datum>(data: Datum, i: number): Tooltip;
  attr(name: string): string;
  attr(name: string, value: d3.Primitive): Tooltip;
  attr<Datum>(name: string, value: (datum: Datum, index: number, outerIndex: number) => d3.Primitive): Tooltip;
  attr<Datum>(obj: { [key: string]: d3.Primitive | ((datum: Datum, index: number, outerIndex: number) => d3.Primitive) }): Tooltip;
  style(name: string): string;
  style(name: string, value: d3.Primitive, priority?: string): Tooltip;
  style<Datum>(name: string, value: (datum: Datum, index: number, outerIndex: number) => d3.Primitive, priority?: string): Tooltip;
  style<Datum>(obj: { [key: string]: d3.Primitive | ((datum: Datum, index: number, outerIndex: number) => d3.Primitive) }, priority?: string): Tooltip;
  offset(): [number, number];
  offset(tuple: [number, number]): Tooltip;
  offset<Datum>(func: (datum: Datum, index: number, outerIndex: number) => [number, number]): Tooltip;
  direction(): TooltipDirection;
  direction(direction: TooltipDirection): Tooltip;
  direction<Datum>(func: (datum: Datum, index: number, outerIndex: number) => TooltipDirection): Tooltip;
  html(): string;
  html(content: string): Tooltip;
  html<Datum>(func: (datum: Datum, index: number, outerIndex: number) => string): Tooltip;
  rootElement(): HTMLElement;
  rootElement(element: HTMLElement): Tooltip;
  rootElement<Datum>(func: (datum: Datum, index: number, outerIndex: number) => HTMLElement): Tooltip;
  destroy(): Tooltip;
}
export interface d3_tip {
  tip(): Tooltip;
}

export const d3: (typeof _d3) & d3_tip = <any> _d3;