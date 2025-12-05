import { Tool, LineType, ToolOptions, BackgroundStyle } from './types';

interface ToolbarProps {
  options: ToolOptions;
  onOptionsChange: (options: Partial<ToolOptions>) => void;
  onClear: () => void;
  onUndo: () => void;
  isConnected: boolean;
}

const tools: { value: Tool; label: string; icon: string }[] = [
  { value: 'select', label: 'Select', icon: '👆' },
  { value: 'pen', label: 'Pen', icon: '✏️' },
  { value: 'lasso', label: 'Lasso', icon: '◉' },
  { value: 'line', label: 'Line', icon: '/' },
  { value: 'rectangle', label: 'Rectangle', icon: '▭' },
  { value: 'circle', label: 'Circle', icon: '○' },
  { value: 'arrow', label: 'Arrow', icon: '→' },
  { value: 'text', label: 'Text', icon: 'T' },
  { value: 'laser', label: 'Laser', icon: '✨' },
  { value: 'eraser', label: 'Eraser', icon: '⌫' },
  { value: 'object-eraser', label: 'Delete', icon: '×' },
];

const colors = [
  '#000000', '#FF0000', '#00FF00', '#0000FF', 
  '#FFFF00', '#FF00FF', '#00FFFF', '#FFA500',
  '#800080', '#FFC0CB', '#A52A2A', '#808080'
];

const lineWidths = [2, 4, 6, 8, 12, 16];

const backgroundStyles: { value: BackgroundStyle; label: string; icon: string }[] = [
  { value: 'blank', label: 'Blank', icon: '⬜' },
  { value: 'grid', label: 'Grid', icon: '⊞' },
  { value: 'dots', label: 'Dots', icon: '⋮⋮' },
  { value: 'lines', label: 'Lines', icon: '☰' },
];

export default function Toolbar({ options, onOptionsChange, onClear, onUndo, isConnected }: ToolbarProps) {
  return (
    <div className="toolbar">
      <div className="toolbar-section">
        <div className="connection-status">
          <div className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`} />
          {isConnected ? 'Connected' : 'Disconnected'}
        </div>
      </div>

      <div className="toolbar-section">
        <label>Tool:</label>
        <div className="tool-buttons">
          {tools.map(tool => (
            <button
              key={tool.value}
              className={`tool-btn ${options.tool === tool.value ? 'active' : ''}`}
              onClick={() => onOptionsChange({ tool: tool.value })}
              title={tool.label}
            >
              <span className="tool-icon">{tool.icon}</span>
              <span className="tool-label">{tool.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="toolbar-section">
        <label>Color:</label>
        <div className="color-palette">
          {colors.map(color => (
            <button
              key={color}
              className={`color-btn ${options.color === color ? 'active' : ''}`}
              style={{ backgroundColor: color }}
              onClick={() => onOptionsChange({ color })}
              title={color}
            />
          ))}
        </div>
      </div>

      <div className="toolbar-section">
        <label>Line Width:</label>
        <div className="width-buttons">
          {lineWidths.map(width => (
            <button
              key={width}
              className={`width-btn ${options.lineWidth === width ? 'active' : ''}`}
              onClick={() => onOptionsChange({ lineWidth: width })}
            >
              {width}px
            </button>
          ))}
        </div>
      </div>

      <div className="toolbar-section">
        <label>Line Type:</label>
        <div className="line-type-buttons">
          <button
            className={`line-type-btn ${options.lineType === 'solid' ? 'active' : ''}`}
            onClick={() => onOptionsChange({ lineType: 'solid' })}
          >
            Solid ━━━
          </button>
          <button
            className={`line-type-btn ${options.lineType === 'dashed' ? 'active' : ''}`}
            onClick={() => onOptionsChange({ lineType: 'dashed' })}
          >
            Dashed ┄┄┄
          </button>
        </div>
      </div>

      <div className="toolbar-section">
        <label>Background:</label>
        <div className="background-buttons">
          {backgroundStyles.map(style => (
            <button
              key={style.value}
              className={`background-btn ${options.backgroundStyle === style.value ? 'active' : ''}`}
              onClick={() => onOptionsChange({ backgroundStyle: style.value })}
              title={style.label}
            >
              <span className="background-icon">{style.icon}</span>
              <span className="background-label">{style.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="toolbar-section">
        <button className="action-btn undo-btn" onClick={onUndo}>
          ↶ Undo
        </button>
        <button className="action-btn clear-btn" onClick={onClear}>
          🗑️ Clear All
        </button>
      </div>

      <div className="toolbar-section">
        <div className="paste-hint" title="Press Ctrl/Cmd+V to paste images or text">
          📋 Paste
        </div>
      </div>
    </div>
  );
}

