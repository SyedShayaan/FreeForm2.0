export type Tool = 'pen' | 'line' | 'rectangle' | 'circle' | 'arrow' | 'eraser' | 'text' | 'object-eraser' | 'laser' | 'lasso';
export type LineType = 'solid' | 'dashed';
export type BackgroundStyle = 'blank' | 'grid' | 'dots' | 'lines';

export interface Point {
  x: number;
  y: number;
}

export interface DrawEvent {
  type: string;
  tool: Tool;
  color: string;
  lineWidth: number;
  lineType: LineType;
  points: Point[];
  timestamp: number;
  id: string;
  clientId?: string;
  text?: string;
  fontSize?: number;
  imageData?: string;
  imageWidth?: number;
  imageHeight?: number;
}

export interface CanvasState {
  elements: DrawEvent[];
  lastModified: string;
}

export interface ToolOptions {
  tool: Tool;
  color: string;
  lineWidth: number;
  lineType: LineType;
  backgroundStyle: BackgroundStyle;
}

