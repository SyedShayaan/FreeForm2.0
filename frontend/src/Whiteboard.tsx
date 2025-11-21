import { useEffect, useRef, useState, useCallback } from 'react';
import { DrawEvent, Point, ToolOptions } from './types';

interface WhiteboardProps {
  options: ToolOptions;
  initialElements: DrawEvent[];
  onDrawEvent: (event: DrawEvent) => void;
  onDeleteElement: (elementId: string) => void;
  onRemoteDrawEvent: (handler: (event: DrawEvent) => void) => () => void;
  onRemoteDeleteEvent: (handler: (elementId: string) => void) => () => void;
  onClearCanvas: (handler: () => void) => () => void;
  onUndoCanvas: (handler: (elementId: string) => void) => () => void;
}

export default function Whiteboard({
  options,
  initialElements,
  onDrawEvent,
  onDeleteElement,
  onRemoteDrawEvent,
  onRemoteDeleteEvent,
  onClearCanvas,
  onUndoCanvas
}: WhiteboardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPoints, setCurrentPoints] = useState<Point[]>([]);
  const [elements, setElements] = useState<DrawEvent[]>(initialElements);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [hoveredElementId, setHoveredElementId] = useState<string | null>(null);
  const [textInputPos, setTextInputPos] = useState<Point | null>(null);
  const [textInputValue, setTextInputValue] = useState('');
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const canBlurRef = useRef(false);
  const [laserElements, setLaserElements] = useState<Map<string, { element: DrawEvent; opacity: number }>>(new Map());
  const imageCache = useRef<Map<string, HTMLImageElement>>(new Map());
  const [pasteNotification, setPasteNotification] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const lastPinchDistanceRef = useRef<number | null>(null);
  const lastMousePosRef = useRef<Point>({ x: 0, y: 0 });
  const deletedElementsRef = useRef<Set<string>>(new Set());
  const [selectedElementIds, setSelectedElementIds] = useState<Set<string>>(new Set());
  const [lassoPath, setLassoPath] = useState<Point[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<Point | null>(null);

  // Initialize elements when initialElements change
  useEffect(() => {
    setElements(initialElements);
  }, [initialElements]);

  // Clear selection when switching away from lasso tool
  useEffect(() => {
    if (options.tool !== 'lasso') {
      setSelectedElementIds(new Set());
      setLassoPath([]);
      setIsDragging(false);
      setDragStart(null);
    }
  }, [options.tool]);

  // Function to delete all selected items
  const deleteSelectedItems = useCallback(() => {
    if (selectedElementIds.size === 0) return;
    
    // Delete all selected elements
    selectedElementIds.forEach(id => {
      onDeleteElement(id);
    });
    
    // Remove from local state
    setElements(prev => prev.filter(el => !selectedElementIds.has(el.id)));
    
    // Clear selection
    setSelectedElementIds(new Set());
  }, [selectedElementIds, onDeleteElement]);

  // Handle keyboard shortcuts for deleting selected items
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Delete/Backspace key to delete selected items
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedElementIds.size > 0) {
        // Don't delete if user is typing in text input
        if (textInputPos) return;
        
        e.preventDefault();
        deleteSelectedItems();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedElementIds, textInputPos, deleteSelectedItems]);

  // Focus text input when it appears
  useEffect(() => {
    if (textInputPos && textInputRef.current) {
      canBlurRef.current = false;
      // Small delay to ensure the input is rendered and prevent immediate blur
      const timer = setTimeout(() => {
        textInputRef.current?.focus();
        canBlurRef.current = true;
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [textInputPos]);

  // Handle paste events for text and images
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      // Don't handle paste if we're in a text input
      if (textInputPos) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];

        // Handle image paste
        if (item.type.indexOf('image') !== -1) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (!blob) continue;

          const reader = new FileReader();
          reader.onload = (event) => {
            const imageData = event.target?.result as string;
            if (!imageData) {
              console.error('Failed to read image data');
              return;
            }
            
            const img = new Image();
            img.onload = () => {
              // Calculate size - max 800px width/height while maintaining aspect ratio
              let width = img.width;
              let height = img.height;
              const maxSize = 800;
              
              console.log('Original image size:', width, 'x', height);
              
              if (width > maxSize || height > maxSize) {
                if (width > height) {
                  height = (height / width) * maxSize;
                  width = maxSize;
                } else {
                  width = (width / height) * maxSize;
                  height = maxSize;
                }
              }

              // Use last mouse position or center of viewport
              const pasteX = lastMousePosRef.current.x - width / 2;
              const pasteY = lastMousePosRef.current.y - height / 2;

              console.log('Pasting image at:', pasteX, pasteY, 'Size:', width, 'x', height);

              const drawEvent: DrawEvent = {
                type: 'draw',
                tool: 'pen', // Use pen as default tool type
                color: options.color,
                lineWidth: options.lineWidth,
                lineType: options.lineType,
                points: [{ x: pasteX, y: pasteY }],
                timestamp: Date.now(),
                id: `${Date.now()}-${Math.random()}`,
                imageData,
                imageWidth: width,
                imageHeight: height
              };

              console.log('Created draw event:', drawEvent);
              console.log('Image data length:', imageData.length);
              setElements(prev => {
                const newElements = [...prev, drawEvent];
                console.log('Elements after adding image:', newElements.length);
                return newElements;
              });
              onDrawEvent(drawEvent);
              
              // Show notification
              setPasteNotification('Image pasted! 🖼️');
              setTimeout(() => setPasteNotification(null), 2000);
            };
            img.src = imageData;
          };
          reader.readAsDataURL(blob);
        }
        // Handle text paste
        else if (item.type === 'text/plain') {
          e.preventDefault();
          item.getAsString((text) => {
            // Use last mouse position
            const pasteX = lastMousePosRef.current.x;
            const pasteY = lastMousePosRef.current.y;

            const drawEvent: DrawEvent = {
              type: 'draw',
              tool: 'text',
              color: options.color,
              lineWidth: options.lineWidth,
              lineType: options.lineType,
              points: [{ x: pasteX, y: pasteY }],
              text: text,
              fontSize: options.lineWidth * 6,
              timestamp: Date.now(),
              id: `${Date.now()}-${Math.random()}`
            };

            setElements(prev => [...prev, drawEvent]);
            onDrawEvent(drawEvent);
            
            // Show notification
            setPasteNotification('Text pasted! 📝');
            setTimeout(() => setPasteNotification(null), 2000);
          });
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => {
      window.removeEventListener('paste', handlePaste);
    };
  }, [textInputPos, offset, zoom, options, onDrawEvent]);

  // Fade out laser elements over time
  useEffect(() => {
    const interval = setInterval(() => {
      setLaserElements(prev => {
        const newMap = new Map(prev);
        let hasChanges = false;

        newMap.forEach((value, key) => {
          const age = Date.now() - value.element.timestamp;
          const fadeStart = 1500; // Start fading after 1.5 seconds
          const fadeDuration = 1000; // Fade over 1 second
          
          if (age > fadeStart + fadeDuration) {
            // Remove completely faded elements
            newMap.delete(key);
            hasChanges = true;
          } else if (age > fadeStart) {
            // Calculate opacity for fading elements
            const fadeProgress = (age - fadeStart) / fadeDuration;
            const newOpacity = 1 - fadeProgress;
            if (value.opacity !== newOpacity) {
              newMap.set(key, { ...value, opacity: newOpacity });
              hasChanges = true;
            }
          }
        });

        return hasChanges ? newMap : prev;
      });
    }, 50); // Update every 50ms for smooth fade

    return () => clearInterval(interval);
  }, []);

  // Subscribe to remote draw events
  useEffect(() => {
    const unsubscribeDraw = onRemoteDrawEvent((event: DrawEvent) => {
      if (event.type === 'laser' || event.tool === 'laser') {
        // Add laser to temporary elements
        setLaserElements(prev => new Map(prev).set(event.id, { element: event, opacity: 1 }));
      } else {
        setElements(prev => {
          // Check if element already exists (for text edits)
          const existingIndex = prev.findIndex(el => el.id === event.id);
          if (existingIndex !== -1) {
            // Update existing element
            const newElements = [...prev];
            newElements[existingIndex] = event;
            return newElements;
          }
          // Add new element
          return [...prev, event];
        });
      }
    });

    const unsubscribeDelete = onRemoteDeleteEvent((elementId: string) => {
      setElements(prev => prev.filter(el => el.id !== elementId));
    });

    const unsubscribeClear = onClearCanvas(() => {
      setElements([]);
    });

    const unsubscribeUndo = onUndoCanvas((elementId: string) => {
      setElements(prev => prev.filter(el => el.id !== elementId));
    });

    return () => {
      unsubscribeDraw();
      unsubscribeDelete();
      unsubscribeClear();
      unsubscribeUndo();
    };
  }, [onRemoteDrawEvent, onRemoteDeleteEvent, onClearCanvas, onUndoCanvas]);

  // Draw background pattern
  const drawBackground = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    const style = options.backgroundStyle;
    
    if (style === 'blank') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      return;
    }

    // Calculate visible area with zoom and offset
    const startX = Math.floor((-offset.x / zoom) / 50) * 50;
    const startY = Math.floor((-offset.y / zoom) / 50) * 50;
    const endX = Math.ceil((width - offset.x) / zoom / 50) * 50;
    const endY = Math.ceil((height - offset.y) / zoom / 50) * 50;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.translate(offset.x, offset.y);
    ctx.scale(zoom, zoom);

    if (style === 'grid') {
      ctx.strokeStyle = '#e0e0e0';
      ctx.lineWidth = 1 / zoom;
      
      // Draw vertical lines
      for (let x = startX; x <= endX; x += 50) {
        ctx.beginPath();
        ctx.moveTo(x, startY);
        ctx.lineTo(x, endY);
        ctx.stroke();
      }
      
      // Draw horizontal lines
      for (let y = startY; y <= endY; y += 50) {
        ctx.beginPath();
        ctx.moveTo(startX, y);
        ctx.lineTo(endX, y);
        ctx.stroke();
      }
    } else if (style === 'dots') {
      ctx.fillStyle = '#d0d0d0';
      const dotSize = 2 / zoom;
      
      for (let x = startX; x <= endX; x += 50) {
        for (let y = startY; y <= endY; y += 50) {
          ctx.beginPath();
          ctx.arc(x, y, dotSize, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (style === 'lines') {
      ctx.strokeStyle = '#e0e0e0';
      ctx.lineWidth = 1 / zoom;
      
      // Draw horizontal lines only
      for (let y = startY; y <= endY; y += 50) {
        ctx.beginPath();
        ctx.moveTo(startX, y);
        ctx.lineTo(endX, y);
        ctx.stroke();
      }
    }

    ctx.restore();
  };

  // Redraw canvas whenever elements, offset, or zoom changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size to window size
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    // Draw background
    drawBackground(ctx, canvas.width, canvas.height);

    // Apply zoom and offset for infinite canvas
    ctx.save();
    ctx.translate(offset.x, offset.y);
    ctx.scale(zoom, zoom);

    // Draw all elements
    elements.forEach(element => {
      const isHovered = options.tool === 'object-eraser' && element.id === hoveredElementId;
      const isSelected = selectedElementIds.has(element.id);
      if (element.imageData) {
        console.log('Drawing element with imageData:', element.id);
      }
      drawElement(ctx, element, isHovered, undefined, isSelected);
    });

    // Draw laser elements with fade
    laserElements.forEach(({ element, opacity }) => {
      drawElement(ctx, element, false, opacity);
    });

    // Draw current drawing in progress
    if (isDrawing && currentPoints.length > 0) {
      const tempElement: DrawEvent = {
        type: 'draw',
        tool: options.tool,
        color: options.color,
        lineWidth: options.lineWidth,
        lineType: options.lineType,
        points: currentPoints,
        timestamp: Date.now(),
        id: `temp-${Date.now()}`
      };
      drawElement(ctx, tempElement, false, options.tool === 'laser' ? 1 : undefined);
    }

    // Draw lasso selection path
    if (options.tool === 'lasso' && lassoPath.length > 0) {
      ctx.strokeStyle = '#2196F3';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(lassoPath[0].x, lassoPath[0].y);
      for (let i = 1; i < lassoPath.length; i++) {
        ctx.lineTo(lassoPath[i].x, lassoPath[i].y);
      }
      // Close the path
      if (lassoPath.length > 2) {
        ctx.lineTo(lassoPath[0].x, lassoPath[0].y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  }, [elements, offset, zoom, isDrawing, currentPoints, options, hoveredElementId, laserElements, selectedElementIds, lassoPath]);

  const drawElement = (ctx: CanvasRenderingContext2D, element: DrawEvent, isHovered = false, opacity?: number, isSelected = false) => {
    ctx.strokeStyle = element.color;
    ctx.fillStyle = element.color;
    ctx.lineWidth = element.lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (element.lineType === 'dashed') {
      ctx.setLineDash([10, 10]);
    } else {
      ctx.setLineDash([]);
    }

    const points = element.points;
    if (points.length === 0 && element.tool !== 'text') return;

    // Highlight selected elements
    if (isSelected) {
      ctx.save();
      ctx.strokeStyle = 'rgba(33, 150, 243, 0.8)';
      ctx.lineWidth = 3;
      ctx.setLineDash([5, 5]);
      
      // Draw selection box around element
      const bounds = getElementBounds(element);
      if (bounds) {
        ctx.strokeRect(bounds.minX - 5, bounds.minY - 5, bounds.maxX - bounds.minX + 10, bounds.maxY - bounds.minY + 10);
      }
      
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Highlight hovered element for object eraser or text editing
    if (isHovered) {
      ctx.save();
      if (options.tool === 'object-eraser') {
        ctx.strokeStyle = 'rgba(255, 0, 0, 0.6)';
        ctx.lineWidth = element.lineWidth + 4;
        
        // Special handling for images
        if (element.imageData && element.points.length > 0) {
          const pos = element.points[0];
          const width = element.imageWidth || 100;
          const height = element.imageHeight || 100;
          ctx.fillStyle = 'rgba(255, 0, 0, 0.1)';
          ctx.fillRect(pos.x, pos.y, width, height);
          ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
          ctx.lineWidth = 3;
          ctx.strokeRect(pos.x, pos.y, width, height);
        }
      } else if (options.tool === 'text' && element.tool === 'text') {
        // Highlight text with a subtle blue background
        if (element.text && element.points.length > 0) {
          const fontSize = element.fontSize || 24;
          ctx.font = `${fontSize}px sans-serif`;
          const metrics = ctx.measureText(element.text);
          const textWidth = metrics.width;
          const textHeight = fontSize;
          const pos = element.points[0];
          ctx.fillStyle = 'rgba(33, 150, 243, 0.1)';
          ctx.fillRect(pos.x - 4, pos.y - textHeight - 4, textWidth + 8, textHeight + 8);
        }
      }
    }

    // Check for imageData first, before tool type
    if (element.imageData) {
      drawImage(ctx, element);
    } else if (element.tool === 'pen') {
      drawFreehand(ctx, points);
    } else if (element.tool === 'laser') {
      drawLaser(ctx, points, opacity !== undefined ? opacity : 1);
    } else if (element.tool === 'line') {
      drawLine(ctx, points[0], points[points.length - 1]);
    } else if (element.tool === 'rectangle') {
      drawRectangle(ctx, points[0], points[points.length - 1]);
    } else if (element.tool === 'circle') {
      drawCircle(ctx, points[0], points[points.length - 1]);
    } else if (element.tool === 'arrow') {
      drawArrow(ctx, points[0], points[points.length - 1]);
    } else if (element.tool === 'text' && element.text) {
      drawText(ctx, element);
    } else if (element.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = element.lineWidth * 2;
      drawFreehand(ctx, points);
      ctx.globalCompositeOperation = 'source-over';
    }

    if (isHovered) {
      ctx.restore();
    }
  };

  const drawFreehand = (ctx: CanvasRenderingContext2D, points: Point[]) => {
    if (points.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();
  };

  const drawLaser = (ctx: CanvasRenderingContext2D, points: Point[], opacity: number) => {
    if (points.length < 2) return;
    
    ctx.save();
    ctx.globalAlpha = opacity;
    
    const color = typeof ctx.fillStyle === 'string' ? ctx.fillStyle : '#000000';
    
    // Draw outer glow
    ctx.strokeStyle = color;
    ctx.lineWidth = ctx.lineWidth * 3;
    ctx.shadowBlur = 20;
    ctx.shadowColor = color;
    ctx.globalAlpha = opacity * 0.3;
    
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();
    
    // Draw middle glow
    ctx.lineWidth = ctx.lineWidth / 3 * 2;
    ctx.globalAlpha = opacity * 0.6;
    ctx.shadowBlur = 10;
    
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();
    
    // Draw bright core
    ctx.lineWidth = ctx.lineWidth / 2;
    ctx.globalAlpha = opacity;
    ctx.shadowBlur = 5;
    
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();
    
    ctx.restore();
  };

  const drawLine = (ctx: CanvasRenderingContext2D, start: Point, end: Point) => {
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  };

  const drawRectangle = (ctx: CanvasRenderingContext2D, start: Point, end: Point) => {
    const width = end.x - start.x;
    const height = end.y - start.y;
    ctx.strokeRect(start.x, start.y, width, height);
  };

  const drawCircle = (ctx: CanvasRenderingContext2D, start: Point, end: Point) => {
    const radius = Math.sqrt(
      Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2)
    );
    ctx.beginPath();
    ctx.arc(start.x, start.y, radius, 0, 2 * Math.PI);
    ctx.stroke();
  };

  const drawArrow = (ctx: CanvasRenderingContext2D, start: Point, end: Point) => {
    const headLength = 20;
    const angle = Math.atan2(end.y - start.y, end.x - start.x);

    // Draw line
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();

    // Draw arrowhead
    ctx.beginPath();
    ctx.moveTo(end.x, end.y);
    ctx.lineTo(
      end.x - headLength * Math.cos(angle - Math.PI / 6),
      end.y - headLength * Math.sin(angle - Math.PI / 6)
    );
    ctx.moveTo(end.x, end.y);
    ctx.lineTo(
      end.x - headLength * Math.cos(angle + Math.PI / 6),
      end.y - headLength * Math.sin(angle + Math.PI / 6)
    );
    ctx.stroke();
  };

  const drawText = (ctx: CanvasRenderingContext2D, element: DrawEvent) => {
    if (!element.text || element.points.length === 0) return;
    const fontSize = element.fontSize || 24;
    ctx.font = `${fontSize}px sans-serif`;
    ctx.fillStyle = element.color;
    ctx.fillText(element.text, element.points[0].x, element.points[0].y);
  };

  const drawImage = (ctx: CanvasRenderingContext2D, element: DrawEvent) => {
    if (!element.imageData || element.points.length === 0) {
      console.log('drawImage: missing data or points', element.id);
      return;
    }
    
    console.log('drawImage called for:', element.id);
    
    // Check if image is already cached
    let img = imageCache.current.get(element.id);
    
    if (!img) {
      // Create new image and cache it
      img = new Image();
      img.crossOrigin = 'anonymous'; // Handle CORS if needed
      imageCache.current.set(element.id, img);
      
      // Force a redraw when image loads
      img.onload = () => {
        console.log('Image loaded:', element.id);
        const canvas = canvasRef.current;
        if (canvas) {
          // Trigger a re-render by forcing re-draw
          requestAnimationFrame(() => {
            setElements(prev => [...prev]);
          });
        }
      };
      
      img.onerror = (e) => {
        console.error('Image load error:', e);
      };
      
      // Set src after setting up handlers
      img.src = element.imageData;
    }
    
    // Only draw if image is loaded
    if (img.complete && img.naturalHeight !== 0) {
      const pos = element.points[0];
      const width = element.imageWidth || img.width;
      const height = element.imageHeight || img.height;
      
      console.log('Drawing image at:', pos.x, pos.y, 'size:', width, height);
      
      ctx.save();
      // Add subtle shadow for images
      ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 2;
      
      try {
        ctx.drawImage(img, pos.x, pos.y, width, height);
        console.log('Image drawn successfully');
      } catch (e) {
        console.error('Error drawing image:', e);
      }
      
      // Draw border around image
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
      ctx.lineWidth = 1;
      ctx.strokeRect(pos.x, pos.y, width, height);
      
      ctx.restore();
    } else {
      console.log('Image not ready:', img.complete, img.naturalHeight);
    }
  };

  const isPointNearElement = (point: Point, element: DrawEvent, threshold = 10): boolean => {
    if (element.imageData) {
      // Check if point is inside image bounds
      if (element.points.length === 0) return false;
      const pos = element.points[0];
      const width = element.imageWidth || 100;
      const height = element.imageHeight || 100;
      return (
        point.x >= pos.x - threshold &&
        point.x <= pos.x + width + threshold &&
        point.y >= pos.y - threshold &&
        point.y <= pos.y + height + threshold
      );
    }

    if (element.tool === 'text') {
      if (!element.text || element.points.length === 0) return false;
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx) return false;
      const fontSize = element.fontSize || 24;
      ctx.font = `${fontSize}px sans-serif`;
      const metrics = ctx.measureText(element.text);
      const textWidth = metrics.width;
      const textHeight = fontSize;
      const pos = element.points[0];
      return (
        point.x >= pos.x - threshold &&
        point.x <= pos.x + textWidth + threshold &&
        point.y >= pos.y - textHeight - threshold &&
        point.y <= pos.y + threshold
      );
    }

    const points = element.points;
    if (points.length === 0) return false;

    if (element.tool === 'pen' || element.tool === 'eraser') {
      return points.some(p => 
        Math.sqrt(Math.pow(p.x - point.x, 2) + Math.pow(p.y - point.y, 2)) < threshold + element.lineWidth
      );
    } else if (element.tool === 'line' || element.tool === 'arrow') {
      const start = points[0];
      const end = points[points.length - 1];
      return distanceToLine(point, start, end) < threshold + element.lineWidth;
    } else if (element.tool === 'rectangle') {
      const start = points[0];
      const end = points[points.length - 1];
      const minX = Math.min(start.x, end.x);
      const maxX = Math.max(start.x, end.x);
      const minY = Math.min(start.y, end.y);
      const maxY = Math.max(start.y, end.y);
      return (
        point.x >= minX - threshold &&
        point.x <= maxX + threshold &&
        point.y >= minY - threshold &&
        point.y <= maxY + threshold &&
        (point.x <= minX + threshold || point.x >= maxX - threshold ||
         point.y <= minY + threshold || point.y >= maxY - threshold)
      );
    } else if (element.tool === 'circle') {
      const center = points[0];
      const radius = Math.sqrt(
        Math.pow(points[points.length - 1].x - center.x, 2) +
        Math.pow(points[points.length - 1].y - center.y, 2)
      );
      const dist = Math.sqrt(
        Math.pow(point.x - center.x, 2) + Math.pow(point.y - center.y, 2)
      );
      return Math.abs(dist - radius) < threshold + element.lineWidth;
    }

    return false;
  };

  const getElementBounds = (element: DrawEvent): { minX: number; minY: number; maxX: number; maxY: number } | null => {
    if (element.points.length === 0) return null;

    if (element.imageData) {
      const pos = element.points[0];
      const width = element.imageWidth || 100;
      const height = element.imageHeight || 100;
      return {
        minX: pos.x,
        minY: pos.y,
        maxX: pos.x + width,
        maxY: pos.y + height
      };
    }

    if (element.tool === 'text' && element.text) {
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx) return null;
      const fontSize = element.fontSize || 24;
      ctx.font = `${fontSize}px sans-serif`;
      const metrics = ctx.measureText(element.text);
      const pos = element.points[0];
      return {
        minX: pos.x,
        minY: pos.y - fontSize,
        maxX: pos.x + metrics.width,
        maxY: pos.y
      };
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    element.points.forEach(p => {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    });

    return { minX, minY, maxX, maxY };
  };

  const isPointInPolygon = (point: Point, polygon: Point[]): boolean => {
    if (polygon.length < 3) return false;

    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x, yi = polygon[i].y;
      const xj = polygon[j].x, yj = polygon[j].y;

      const intersect = ((yi > point.y) !== (yj > point.y))
        && (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }

    return inside;
  };

  const isElementInLasso = (element: DrawEvent, lassoPolygon: Point[]): boolean => {
    if (lassoPolygon.length < 3) return false;

    const bounds = getElementBounds(element);
    if (!bounds) return false;

    // Check if any corner of the element's bounding box is inside the lasso
    const corners = [
      { x: bounds.minX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.minY },
      { x: bounds.minX, y: bounds.maxY },
      { x: bounds.maxX, y: bounds.maxY }
    ];

    // If any corner is inside, consider the element selected
    return corners.some(corner => isPointInPolygon(corner, lassoPolygon));
  };

  const distanceToLine = (point: Point, lineStart: Point, lineEnd: Point): number => {
    const A = point.x - lineStart.x;
    const B = point.y - lineStart.y;
    const C = lineEnd.x - lineStart.x;
    const D = lineEnd.y - lineStart.y;

    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;
    if (lenSq !== 0) param = dot / lenSq;

    let xx, yy;

    if (param < 0) {
      xx = lineStart.x;
      yy = lineStart.y;
    } else if (param > 1) {
      xx = lineEnd.x;
      yy = lineEnd.y;
    } else {
      xx = lineStart.x + param * C;
      yy = lineStart.y + param * D;
    }

    const dx = point.x - xx;
    const dy = point.y - yy;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const getMousePos = (e: React.MouseEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left - offset.x) / zoom,
      y: (e.clientY - rect.top - offset.y) / zoom
    };
  };

  const getTouchPos = (e: React.TouchEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches[0] || e.changedTouches[0];
    return {
      x: (touch.clientX - rect.left - offset.x) / zoom,
      y: (touch.clientY - rect.top - offset.y) / zoom
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      // Middle mouse or Shift+Left mouse for panning
      setIsPanning(true);
      setPanStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
      return;
    }

    if (e.button !== 0) return; // Only left mouse button for drawing

    const point = getMousePos(e);

    // Handle lasso tool
    if (options.tool === 'lasso') {
      // Check if clicking on a selected element to drag
      const clickedSelected = [...elements].reverse().find(el => 
        selectedElementIds.has(el.id) && isPointNearElement(point, el, 10)
      );
      
      if (clickedSelected && selectedElementIds.size > 0) {
        // Start dragging selected elements
        setIsDragging(true);
        setDragStart(point);
      } else {
        // Start drawing new lasso selection
        setIsDrawing(true);
        setLassoPath([point]);
        setSelectedElementIds(new Set());
      }
      return;
    }

    // Handle text tool - check if clicking existing text to edit it
    if (options.tool === 'text') {
      const clickedText = [...elements].reverse().find(el => 
        el.tool === 'text' && isPointNearElement(point, el, 5)
      );
      
      if (clickedText) {
        // Edit existing text
        setTextInputPos(clickedText.points[0]);
        setTextInputValue(clickedText.text || '');
        setEditingTextId(clickedText.id);
      } else {
        // Create new text
        setTextInputPos(point);
        setTextInputValue('');
        setEditingTextId(null);
      }
      return;
    }

    // Handle object eraser - start drag-to-delete mode
    if (options.tool === 'object-eraser') {
      setIsDrawing(true);
      deletedElementsRef.current = new Set(); // Reset deleted elements tracking
      
      // Delete element under cursor immediately
      const clickedElement = [...elements].reverse().find(el => 
        isPointNearElement(point, el, 15)
      );
      if (clickedElement) {
        deletedElementsRef.current.add(clickedElement.id);
        setElements(prev => prev.filter(el => el.id !== clickedElement.id));
        onDeleteElement(clickedElement.id);
      }
      return;
    }

    setIsDrawing(true);
    setCurrentPoints([point]);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isPanning) {
      setOffset({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y
      });
      return;
    }

    const point = getMousePos(e);
    
    // Track mouse position for paste operations
    lastMousePosRef.current = point;

    // Handle lasso dragging
    if (options.tool === 'lasso' && isDragging && dragStart) {
      const dx = point.x - dragStart.x;
      const dy = point.y - dragStart.y;
      
      // Update positions of all selected elements
      setElements(prev => prev.map(el => {
        if (selectedElementIds.has(el.id)) {
          return {
            ...el,
            points: el.points.map(p => ({ x: p.x + dx, y: p.y + dy }))
          };
        }
        return el;
      }));
      
      setDragStart(point);
      return;
    }

    // Handle object eraser hover and drag-to-delete
    if (options.tool === 'object-eraser') {
      const hoveredElement = [...elements].reverse().find(el => 
        isPointNearElement(point, el, 15)
      );
      setHoveredElementId(hoveredElement?.id || null);
      
      // If drawing (dragging), delete elements as we hover over them
      if (isDrawing && hoveredElement && !deletedElementsRef.current.has(hoveredElement.id)) {
        deletedElementsRef.current.add(hoveredElement.id);
        setElements(prev => prev.filter(el => el.id !== hoveredElement.id));
        onDeleteElement(hoveredElement.id);
      }
    } else if (options.tool === 'text') {
      // Highlight text elements when hovering in text mode
      const hoveredText = [...elements].reverse().find(el => 
        el.tool === 'text' && isPointNearElement(point, el, 5)
      );
      setHoveredElementId(hoveredText?.id || null);
    } else {
      setHoveredElementId(null);
    }

    if (!isDrawing) return;

    // Handle lasso selection drawing
    if (options.tool === 'lasso') {
      setLassoPath(prev => [...prev, point]);
      return;
    }

    if (options.tool === 'pen' || options.tool === 'eraser' || options.tool === 'laser') {
      setCurrentPoints(prev => [...prev, point]);
    } else {
      // For shapes, only keep start and end points
      setCurrentPoints(prev => [prev[0], point]);
    }
  };

  const handleMouseUp = () => {
    if (isPanning) {
      setIsPanning(false);
      return;
    }

    // Handle lasso dragging complete
    if (options.tool === 'lasso' && isDragging) {
      setIsDragging(false);
      setDragStart(null);
      
      // Send updated elements to server
      elements.forEach(el => {
        if (selectedElementIds.has(el.id)) {
          onDrawEvent(el);
        }
      });
      return;
    }

    // Handle lasso selection complete
    if (options.tool === 'lasso' && isDrawing && lassoPath.length > 2) {
      // Find all elements inside the lasso
      const selected = new Set<string>();
      elements.forEach(el => {
        if (isElementInLasso(el, lassoPath)) {
          selected.add(el.id);
        }
      });
      
      setSelectedElementIds(selected);
      setLassoPath([]);
      setIsDrawing(false);
      return;
    }

    // Handle object eraser - end drag-to-delete mode
    if (options.tool === 'object-eraser') {
      setIsDrawing(false);
      deletedElementsRef.current.clear();
      return;
    }

    if (!isDrawing) return;

    if (currentPoints.length > 0) {
      const drawEvent: DrawEvent = {
        type: options.tool === 'laser' ? 'laser' : 'draw',
        tool: options.tool,
        color: options.color,
        lineWidth: options.lineWidth,
        lineType: options.lineType,
        points: currentPoints,
        timestamp: Date.now(),
        id: `${Date.now()}-${Math.random()}`
      };

      if (options.tool === 'laser') {
        // Add laser to temporary elements
        setLaserElements(prev => new Map(prev).set(drawEvent.id, { element: drawEvent, opacity: 1 }));
      } else {
        // Add to persistent elements
        setElements(prev => [...prev, drawEvent]);
      }

      // Send to server
      onDrawEvent(drawEvent);
    }

    setIsDrawing(false);
    setCurrentPoints([]);
  };

  const handleTextSubmit = () => {
    if (!textInputPos) {
      return;
    }

    // If text is empty and we're editing, delete the text element
    if (!textInputValue.trim() && editingTextId) {
      setElements(prev => prev.filter(el => el.id !== editingTextId));
      onDeleteElement(editingTextId);
      setTextInputPos(null);
      setTextInputValue('');
      setEditingTextId(null);
      return;
    }

    // Don't save if text is empty for new text
    if (!textInputValue.trim()) {
      setTextInputPos(null);
      setTextInputValue('');
      setEditingTextId(null);
      return;
    }

    if (editingTextId) {
      // Update existing text
      const drawEvent: DrawEvent = {
        type: 'draw',
        tool: 'text',
        color: options.color,
        lineWidth: options.lineWidth,
        lineType: options.lineType,
        points: [textInputPos],
        text: textInputValue,
        fontSize: options.lineWidth * 6,
        timestamp: Date.now(),
        id: editingTextId
      };

      setElements(prev => prev.map(el => el.id === editingTextId ? drawEvent : el));
      onDrawEvent(drawEvent);
    } else {
      // Create new text
      const drawEvent: DrawEvent = {
        type: 'draw',
        tool: 'text',
        color: options.color,
        lineWidth: options.lineWidth,
        lineType: options.lineType,
        points: [textInputPos],
        text: textInputValue,
        fontSize: options.lineWidth * 6,
        timestamp: Date.now(),
        id: `${Date.now()}-${Math.random()}`
      };

      setElements(prev => [...prev, drawEvent]);
      onDrawEvent(drawEvent);
    }

    setTextInputPos(null);
    setTextInputValue('');
    setEditingTextId(null);
  };

  const handleTextBlur = () => {
    // Only save if enough time has passed (prevents immediate blur on creation)
    if (canBlurRef.current) {
      handleTextSubmit();
    }
  };

  // Touch event handlers for iPad/tablet support
  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    
    if (e.touches.length === 2) {
      // Two-finger touch for pinch-to-zoom and panning
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const distance = Math.sqrt(
        Math.pow(touch2.clientX - touch1.clientX, 2) + 
        Math.pow(touch2.clientY - touch1.clientY, 2)
      );
      lastPinchDistanceRef.current = distance;
      
      setIsPanning(true);
      const touch = e.touches[0];
      setPanStart({ x: touch.clientX - offset.x, y: touch.clientY - offset.y });
      return;
    }

    if (e.touches.length !== 1) return;

    const point = getTouchPos(e);

    // Handle lasso tool
    if (options.tool === 'lasso') {
      // Check if clicking on a selected element to drag
      const clickedSelected = [...elements].reverse().find(el => 
        selectedElementIds.has(el.id) && isPointNearElement(point, el, 10)
      );
      
      if (clickedSelected && selectedElementIds.size > 0) {
        // Start dragging selected elements
        setIsDragging(true);
        setDragStart(point);
      } else {
        // Start drawing new lasso selection
        setIsDrawing(true);
        setLassoPath([point]);
        setSelectedElementIds(new Set());
      }
      return;
    }

    // Handle text tool - check if clicking existing text to edit it
    if (options.tool === 'text') {
      const clickedText = [...elements].reverse().find(el => 
        el.tool === 'text' && isPointNearElement(point, el, 5)
      );
      
      if (clickedText) {
        // Edit existing text
        setTextInputPos(clickedText.points[0]);
        setTextInputValue(clickedText.text || '');
        setEditingTextId(clickedText.id);
      } else {
        // Create new text
        setTextInputPos(point);
        setTextInputValue('');
        setEditingTextId(null);
      }
      return;
    }

    // Handle object eraser - start drag-to-delete mode
    if (options.tool === 'object-eraser') {
      setIsDrawing(true);
      deletedElementsRef.current = new Set(); // Reset deleted elements tracking
      
      // Delete element under cursor immediately
      const clickedElement = [...elements].reverse().find(el => 
        isPointNearElement(point, el, 15)
      );
      if (clickedElement) {
        deletedElementsRef.current.add(clickedElement.id);
        setElements(prev => prev.filter(el => el.id !== clickedElement.id));
        onDeleteElement(clickedElement.id);
      }
      return;
    }

    setIsDrawing(true);
    setCurrentPoints([point]);
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();

    if (isPanning && e.touches.length === 2) {
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      
      // Calculate new distance for pinch-to-zoom
      const distance = Math.sqrt(
        Math.pow(touch2.clientX - touch1.clientX, 2) + 
        Math.pow(touch2.clientY - touch1.clientY, 2)
      );
      
      if (lastPinchDistanceRef.current) {
        const scale = distance / lastPinchDistanceRef.current;
        const newZoom = Math.min(Math.max(0.1, zoom * scale), 5);
        
        // Calculate pinch center
        const canvas = canvasRef.current;
        if (canvas) {
          const rect = canvas.getBoundingClientRect();
          const centerX = (touch1.clientX + touch2.clientX) / 2 - rect.left;
          const centerY = (touch1.clientY + touch2.clientY) / 2 - rect.top;
          
          // Zoom towards pinch center
          const zoomScale = newZoom / zoom;
          setOffset({
            x: centerX - (centerX - offset.x) * zoomScale,
            y: centerY - (centerY - offset.y) * zoomScale
          });
          
          setZoom(newZoom);
        }
        
        lastPinchDistanceRef.current = distance;
      }
      
      // Also handle panning with two fingers
      const touch = e.touches[0];
      setOffset({
        x: touch.clientX - panStart.x,
        y: touch.clientY - panStart.y
      });
      return;
    }

    if (e.touches.length !== 1) return;

    const point = getTouchPos(e);

    // Handle lasso dragging
    if (options.tool === 'lasso' && isDragging && dragStart) {
      const dx = point.x - dragStart.x;
      const dy = point.y - dragStart.y;
      
      // Update positions of all selected elements
      setElements(prev => prev.map(el => {
        if (selectedElementIds.has(el.id)) {
          return {
            ...el,
            points: el.points.map(p => ({ x: p.x + dx, y: p.y + dy }))
          };
        }
        return el;
      }));
      
      setDragStart(point);
      return;
    }

    // Handle object eraser hover and drag-to-delete
    if (options.tool === 'object-eraser') {
      const hoveredElement = [...elements].reverse().find(el => 
        isPointNearElement(point, el, 15)
      );
      setHoveredElementId(hoveredElement?.id || null);
      
      // If drawing (dragging), delete elements as we hover over them
      if (isDrawing && hoveredElement && !deletedElementsRef.current.has(hoveredElement.id)) {
        deletedElementsRef.current.add(hoveredElement.id);
        setElements(prev => prev.filter(el => el.id !== hoveredElement.id));
        onDeleteElement(hoveredElement.id);
      }
    } else if (options.tool === 'text') {
      // Highlight text elements when hovering in text mode
      const hoveredText = [...elements].reverse().find(el => 
        el.tool === 'text' && isPointNearElement(point, el, 5)
      );
      setHoveredElementId(hoveredText?.id || null);
    } else {
      setHoveredElementId(null);
    }

    if (!isDrawing) return;

    // Handle lasso selection drawing
    if (options.tool === 'lasso') {
      setLassoPath(prev => [...prev, point]);
      return;
    }

    if (options.tool === 'pen' || options.tool === 'eraser' || options.tool === 'laser') {
      setCurrentPoints(prev => [...prev, point]);
    } else {
      // For shapes, only keep start and end points
      setCurrentPoints(prev => [prev[0], point]);
    }
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();

    if (isPanning) {
      setIsPanning(false);
      lastPinchDistanceRef.current = null;
      return;
    }

    // Handle lasso dragging complete
    if (options.tool === 'lasso' && isDragging) {
      setIsDragging(false);
      setDragStart(null);
      
      // Send updated elements to server
      elements.forEach(el => {
        if (selectedElementIds.has(el.id)) {
          onDrawEvent(el);
        }
      });
      return;
    }

    // Handle lasso selection complete
    if (options.tool === 'lasso' && isDrawing && lassoPath.length > 2) {
      // Find all elements inside the lasso
      const selected = new Set<string>();
      elements.forEach(el => {
        if (isElementInLasso(el, lassoPath)) {
          selected.add(el.id);
        }
      });
      
      setSelectedElementIds(selected);
      setLassoPath([]);
      setIsDrawing(false);
      return;
    }

    // Handle object eraser - end drag-to-delete mode
    if (options.tool === 'object-eraser') {
      setIsDrawing(false);
      deletedElementsRef.current.clear();
      return;
    }

    if (!isDrawing) return;

    if (currentPoints.length > 0) {
      const drawEvent: DrawEvent = {
        type: options.tool === 'laser' ? 'laser' : 'draw',
        tool: options.tool,
        color: options.color,
        lineWidth: options.lineWidth,
        lineType: options.lineType,
        points: currentPoints,
        timestamp: Date.now(),
        id: `${Date.now()}-${Math.random()}`
      };

      if (options.tool === 'laser') {
        // Add laser to temporary elements
        setLaserElements(prev => new Map(prev).set(drawEvent.id, { element: drawEvent, opacity: 1 }));
      } else {
        // Add to persistent elements
        setElements(prev => [...prev, drawEvent]);
      }

      // Send to server
      onDrawEvent(drawEvent);
    }

    setIsDrawing(false);
    setCurrentPoints([]);
  };

  // Mouse wheel zoom for desktop
  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Zoom in or out
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.min(Math.max(0.1, zoom * delta), 5);
    
    // Adjust offset to zoom towards mouse position
    const scale = newZoom / zoom;
    setOffset({
      x: mouseX - (mouseX - offset.x) * scale,
      y: mouseY - (mouseY - offset.y) * scale
    });
    
    setZoom(newZoom);
  };

  // Zoom control functions
  const handleZoomChange = (newZoom: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    // Zoom towards center
    const rect = canvas.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    
    const scale = newZoom / zoom;
    setOffset({
      x: centerX - (centerX - offset.x) * scale,
      y: centerY - (centerY - offset.y) * scale
    });
    
    setZoom(newZoom);
  };

  const handleZoomIn = () => {
    handleZoomChange(Math.min(zoom * 1.2, 5));
  };

  const handleZoomOut = () => {
    handleZoomChange(Math.max(zoom / 1.2, 0.1));
  };

  const handleZoomReset = () => {
    handleZoomChange(1);
  };

  const getCursor = () => {
    if (isPanning) return 'grabbing';
    if (options.tool === 'lasso') {
      if (isDragging) return 'grabbing';
      if (selectedElementIds.size > 0) return 'move';
      return 'crosshair';
    }
    if (options.tool === 'object-eraser') return hoveredElementId ? 'pointer' : 'not-allowed';
    if (options.tool === 'text') return hoveredElementId ? 'pointer' : 'text';
    return 'crosshair';
  };

  return (
    <>
      <canvas
        ref={canvasRef}
        className="whiteboard-canvas"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        style={{ cursor: getCursor(), touchAction: 'none' }}
      />
      
      {textInputPos && (
        <div
          className="text-input-popup"
          style={{
            position: 'absolute',
            left: textInputPos.x + offset.x,
            top: textInputPos.y + offset.y - 10,
          }}
          onMouseDown={(e) => {
            // Prevent canvas mousedown from interfering
            e.stopPropagation();
          }}
        >
          <input
            ref={textInputRef}
            type="text"
            value={textInputValue}
            onChange={(e) => setTextInputValue(e.target.value)}
            onBlur={handleTextBlur}
            onMouseDown={(e) => {
              // Prevent canvas mousedown from interfering
              e.stopPropagation();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleTextSubmit();
              } else if (e.key === 'Escape') {
                setTextInputPos(null);
                setTextInputValue('');
                setEditingTextId(null);
              }
            }}
            placeholder="Type text..."
            style={{
              fontSize: `${options.lineWidth * 6}px`,
              color: options.color,
            }}
          />
        </div>
      )}

      {/* Zoom Controls */}
      <div className="zoom-controls">
        <button 
          className="zoom-btn" 
          onClick={handleZoomOut}
          title="Zoom Out"
        >
          −
        </button>
        
        <input
          type="range"
          className="zoom-slider"
          min="0.1"
          max="5"
          step="0.1"
          value={zoom}
          onChange={(e) => handleZoomChange(parseFloat(e.target.value))}
          title="Zoom Level"
        />
        
        <span className="zoom-level">{Math.round(zoom * 100)}%</span>
        
        <button 
          className="zoom-btn" 
          onClick={handleZoomIn}
          title="Zoom In"
        >
          +
        </button>
        
        <button 
          className="zoom-btn zoom-reset" 
          onClick={handleZoomReset}
          title="Reset Zoom (100%)"
        >
          ⊙
        </button>
      </div>

      {/* Paste Notification */}
      {pasteNotification && (
        <div className="paste-notification">
          {pasteNotification}
        </div>
      )}

      {/* Delete Selected Items Button */}
      {selectedElementIds.size > 0 && (
        <div className="delete-selection-btn">
          <button 
            onClick={deleteSelectedItems}
            title={`Delete ${selectedElementIds.size} selected item${selectedElementIds.size > 1 ? 's' : ''}`}
          >
            <span className="delete-icon">×</span>
            <span className="delete-count">{selectedElementIds.size}</span>
          </button>
          <span className="delete-hint">Press Delete or Backspace</span>
        </div>
      )}
    </>
  );
}

