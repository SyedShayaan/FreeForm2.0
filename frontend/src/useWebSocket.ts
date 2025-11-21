import { useEffect, useRef, useState } from 'react';
import { DrawEvent, CanvasState } from './types';

export const useWebSocket = (url: string) => {
  const [isConnected, setIsConnected] = useState(false);
  const [canvasState, setCanvasState] = useState<CanvasState | null>(null);
  const [clientId, setClientId] = useState<string>('');
  const ws = useRef<WebSocket | null>(null);
  const messageHandlers = useRef<((data: any) => void)[]>([]);

  useEffect(() => {
    const connect = () => {
      try {
        ws.current = new WebSocket(url);

        ws.current.onopen = () => {
          console.log('WebSocket connected');
          setIsConnected(true);
        };

        ws.current.onmessage = (event) => {
          const data = JSON.parse(event.data);
          
          if (data.type === 'init') {
            setCanvasState(data.data);
            // Store client ID from server
            if (data.clientId) {
              setClientId(data.clientId);
            }
          } else {
            // Call all registered message handlers
            messageHandlers.current.forEach(handler => handler(data));
          }
        };

        ws.current.onclose = () => {
          console.log('WebSocket disconnected');
          setIsConnected(false);
          // Attempt to reconnect after 2 seconds
          setTimeout(connect, 2000);
        };

        ws.current.onerror = (error) => {
          console.error('WebSocket error:', error);
        };
      } catch (error) {
        console.error('Failed to connect:', error);
        setTimeout(connect, 2000);
      }
    };

    connect();

    return () => {
      if (ws.current) {
        ws.current.close();
      }
    };
  }, [url]);

  const sendMessage = (message: any) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(message));
    }
  };

  const sendDrawEvent = (event: DrawEvent) => {
    // Add clientId to the event
    const eventWithClientId = { ...event, clientId };
    sendMessage({
      type: event.type === 'laser' || event.tool === 'laser' ? 'laser' : 'draw',
      data: eventWithClientId
    });
  };

  const deleteElement = (elementId: string) => {
    sendMessage({
      type: 'delete',
      elementId: elementId
    });
  };

  const clearCanvas = () => {
    sendMessage({ type: 'clear' });
  };

  const undo = () => {
    sendMessage({ type: 'undo' });
  };

  const onMessage = (handler: (data: any) => void) => {
    messageHandlers.current.push(handler);
    return () => {
      messageHandlers.current = messageHandlers.current.filter(h => h !== handler);
    };
  };

  return {
    isConnected,
    canvasState,
    clientId,
    sendDrawEvent,
    deleteElement,
    clearCanvas,
    undo,
    onMessage
  };
};

