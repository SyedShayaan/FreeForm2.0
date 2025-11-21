import { useState, useEffect } from 'react';
import Whiteboard from './Whiteboard';
import Toolbar from './Toolbar';
import { useWebSocket } from './useWebSocket';
import { ToolOptions } from './types';

// Determine WebSocket URL based on current location
const getWebSocketUrl = () => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.hostname;
  return `${protocol}//${host}:8000/ws`;
};

function App() {
  const [toolOptions, setToolOptions] = useState<ToolOptions>({
    tool: 'pen',
    color: '#000000',
    lineWidth: 4,
    lineType: 'solid',
    backgroundStyle: 'blank'
  });

  const wsUrl = getWebSocketUrl();
  const { isConnected, canvasState, clientId, sendDrawEvent, deleteElement, clearCanvas, undo, onMessage } = useWebSocket(wsUrl);

  const handleOptionsChange = (newOptions: Partial<ToolOptions>) => {
    setToolOptions(prev => ({ ...prev, ...newOptions }));
  };

  const handleClear = () => {
    if (confirm('Clear the entire whiteboard? This will remove all drawings for everyone.')) {
      clearCanvas();
    }
  };

  return (
    <div className="app">
      <Toolbar
        options={toolOptions}
        onOptionsChange={handleOptionsChange}
        onClear={handleClear}
        onUndo={undo}
        isConnected={isConnected}
      />
      
      {canvasState && (
        <Whiteboard
          options={toolOptions}
          initialElements={canvasState.elements}
          onDrawEvent={sendDrawEvent}
          onDeleteElement={deleteElement}
          onRemoteDrawEvent={(handler) => {
            return onMessage((data) => {
              if (data.type === 'draw' || data.type === 'laser') {
                handler(data.data);
              }
            });
          }}
          onRemoteDeleteEvent={(handler) => {
            return onMessage((data) => {
              if (data.type === 'delete') {
                handler(data.elementId);
              }
            });
          }}
          onClearCanvas={(handler) => {
            return onMessage((data) => {
              if (data.type === 'clear') {
                handler();
              }
            });
          }}
          onUndoCanvas={(handler) => {
            return onMessage((data) => {
              if (data.type === 'undo' && data.elementId) {
                handler(data.elementId);
              }
            });
          }}
        />
      )}

      {!isConnected && (
        <div className="connection-overlay">
          <div className="connection-message">
            <h2>Connecting to whiteboard server...</h2>
            <p>Make sure the backend server is running.</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

