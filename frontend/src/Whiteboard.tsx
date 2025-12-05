import { useEffect, useRef, useState, useCallback } from 'react';
import { useGesture } from '@use-gesture/react';
import { DrawEvent, Point, ToolOptions } from './types';

type ResizeHandle = 'tl' | 'tr' | 'bl' | 'br' | 'start' | 'end';

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
  const lastMousePosRef = useRef<Point>({ x: 0, y: 0 });
  const deletedElementsRef = useRef<Set<string>>(new Set());
  const [selectedElementIds, setSelectedElementIds] = useState<Set<string>>(new Set());
  const [lassoPath, setLassoPath] = useState<Point[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [resizeHandle, setResizeHandle] = useState<ResizeHandle | null>(null);
  const [resizingElementId, setResizingElementId] = useState<string | null>(null);

  // Initialize gesture handlers
  const bind = useGesture({
    onDrag: ({ first, last, active, xy: [cx, cy], event, buttons, shiftKey }) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      
      // Handle touch pan specifically (2 fingers) - handled by onPinch usually
      // But check if we need to prevent default
      if (event.type.startsWith('touch') && (event as unknown as TouchEvent).touches?.length === 2) return;

      const rect = canvas.getBoundingClientRect();
      const point = {
        x: (cx - rect.left - offset.x) / zoom,
        y: (cy - rect.top - offset.y) / zoom
      };

      // Pan (Middle Mouse or Shift + Left)
      const isPanGesture = buttons === 4 || (buttons === 1 && shiftKey);
      
      if (isPanGesture) {
        if (first) {
          setIsPanning(true);
          setPanStart({ x: cx - offset.x, y: cy - offset.y });
        } else if (active) {
          setOffset({ x: cx - panStart.x, y: cy - panStart.y });
        } else if (last) {
          setIsPanning(false);
        }
        return;
      }

      // Drawing / Tools Logic
      if (isPanning) return;

      // Select Tool Logic
      if (options.tool === 'select') {
        if (first) {
          // Check for double click to edit text
          if ((event as MouseEvent).detail === 2) {
            const clickedElement = [...elements].reverse().find(el => 
              selectedElementIds.has(el.id) && isPointNearElement(point, el, 10)
            );
            if (clickedElement) {
              const bounds = getElementBounds(clickedElement);
              if (bounds) {
                const centerX = (bounds.minX + bounds.maxX) / 2;
                const centerY = (bounds.minY + bounds.maxY) / 2;
                setTextInputPos({ x: centerX, y: centerY });
                setTextInputValue(clickedElement.text || '');
                setEditingTextId(clickedElement.id);
                return;
              }
            }
          }

          // 1. Check Resize Handles
          if (selectedElementIds.size === 1) {
            const id = Array.from(selectedElementIds)[0];
            const element = elements.find(el => el.id === id);
            if (element) {
              const handle = getResizeHandleAtPoint(point, element);
              if (handle) {
                setResizeHandle(handle);
                setResizingElementId(id);
                setIsDragging(true);
                return;
              }
            }
          }

          // 2. Check Element Click (Move)
          const clickedElement = [...elements].reverse().find(el => 
            isPointNearElement(point, el, 10)
          );

          if (clickedElement) {
            if (!selectedElementIds.has(clickedElement.id)) {
              if (shiftKey) {
                setSelectedElementIds(prev => new Set(prev).add(clickedElement.id));
              } else {
                setSelectedElementIds(new Set([clickedElement.id]));
              }
            } else if (shiftKey) {
               setSelectedElementIds(prev => {
                 const next = new Set(prev);
                 next.delete(clickedElement.id);
                 return next;
               });
               return; // Don't start dragging if deselecting
            }
            
            setIsDragging(true);
            setDragStart(point);
          } else {
            // Clicked empty space - deselect unless shift
            if (!shiftKey) {
              setSelectedElementIds(new Set());
            }
          }
          return;
        }

        if (active) {
          // Handle Resizing
          if (resizeHandle && resizingElementId) {
             setElements(prev => prev.map(el => {
               if (el.id === resizingElementId) {
                 const bounds = getElementBounds(el);
                 if (!bounds) return el;
                 
                 let { minX, minY, maxX, maxY } = bounds;
                 // Simple resizing logic for Rect/Circle (box based)
                 // For line/arrow it's different, but let's start with box logic
                 
                 if (resizeHandle.includes('l')) minX = point.x;
                 if (resizeHandle.includes('r')) maxX = point.x;
                 if (resizeHandle.includes('t')) minY = point.y;
                 if (resizeHandle.includes('b')) maxY = point.y;

                 // Enforce min size
                 if (maxX - minX < 10) maxX = minX + 10;
                 if (maxY - minY < 10) maxY = minY + 10;

                 // Update points based on new bounds
                 let newPoints = el.points;
                 if (el.tool === 'rectangle' || el.tool === 'circle' || el.imageData) {
                   newPoints = [{ x: minX, y: minY }, { x: maxX, y: maxY }];
                 } else if (el.tool === 'line' || el.tool === 'arrow') {
                   // Handle line start/end resizing
                   if (resizeHandle === 'start') {
                       newPoints = [point, ...newPoints.slice(1)];
                   } else if (resizeHandle === 'end') {
                       newPoints = [...newPoints.slice(0, -1), point];
                   }
                 }

                 return { ...el, points: newPoints };
               }
               return el;
             }));
             return;
          }

          // Handle Moving
          if (isDragging && dragStart && selectedElementIds.size > 0) {
            const dx = point.x - dragStart.x;
            const dy = point.y - dragStart.y;
            
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
          }
          return;
        }

        if (last) {
          if (resizingElementId) {
             const el = elements.find(e => e.id === resizingElementId);
             if (el) onDrawEvent(el);
             setResizingElementId(null);
             setResizeHandle(null);
             setIsDragging(false);
          } else if (isDragging && dragStart) {
             elements.forEach(el => {
               if (selectedElementIds.has(el.id)) onDrawEvent(el);
             });
             setIsDragging(false);
             setDragStart(null);
          }
          return;
        }
        return;
      }

      // Handle Start (Down)
      if (first) {
        // Lasso Tool
        if (options.tool === 'lasso') {
          const clickedSelected = [...elements].reverse().find(el => 
            selectedElementIds.has(el.id) && isPointNearElement(point, el, 10)
          );
          
          if (clickedSelected && selectedElementIds.size > 0) {
            setIsDragging(true);
            setDragStart(point);
          } else {
            setIsDrawing(true);
            setLassoPath([point]);
            setSelectedElementIds(new Set());
          }
          return;
        }

        // Text Tool
        if (options.tool === 'text') {
          const clickedText = [...elements].reverse().find(el => 
            el.tool === 'text' && isPointNearElement(point, el, 5)
          );
          
          if (clickedText) {
            setTextInputPos(clickedText.points[0]);
            setTextInputValue(clickedText.text || '');
            setEditingTextId(clickedText.id);
          } else {
            setTextInputPos(point);
            setTextInputValue('');
            setEditingTextId(null);
          }
          return;
        }

        // Object Eraser
        if (options.tool === 'object-eraser') {
          setIsDrawing(true);
          deletedElementsRef.current = new Set();
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

        // Standard Draw
        setIsDrawing(true);
        setCurrentPoints([point]);
      }

      // Handle Move
      if (active) {
        // Track mouse for paste
        lastMousePosRef.current = point;

        if (options.tool === 'lasso' && isDragging && dragStart) {
          const dx = point.x - dragStart.x;
          const dy = point.y - dragStart.y;
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

        if (options.tool === 'object-eraser') {
          const hoveredElement = [...elements].reverse().find(el => 
            isPointNearElement(point, el, 15)
          );
          setHoveredElementId(hoveredElement?.id || null);
          
          if (isDrawing && hoveredElement && !deletedElementsRef.current.has(hoveredElement.id)) {
            deletedElementsRef.current.add(hoveredElement.id);
            setElements(prev => prev.filter(el => el.id !== hoveredElement.id));
            onDeleteElement(hoveredElement.id);
          }
        } else if (options.tool === 'text') {
          const hoveredText = [...elements].reverse().find(el => 
            el.tool === 'text' && isPointNearElement(point, el, 5)
          );
          setHoveredElementId(hoveredText?.id || null);
        } else {
          setHoveredElementId(null);
        }

        if (!isDrawing) return;

        if (options.tool === 'lasso') {
          setLassoPath(prev => [...prev, point]);
          return;
        }

        if (options.tool === 'pen' || options.tool === 'eraser' || options.tool === 'laser') {
          setCurrentPoints(prev => [...prev, point]);
        } else {
          setCurrentPoints(prev => [prev[0], point]);
        }
      }

      // Handle End (Up)
      if (last) {
        if (options.tool === 'lasso' && isDragging) {
          setIsDragging(false);
          setDragStart(null);
          elements.forEach(el => {
            if (selectedElementIds.has(el.id)) onDrawEvent(el);
          });
          return;
        }

        if (options.tool === 'lasso' && isDrawing && lassoPath.length > 2) {
          const selected = new Set<string>();
          elements.forEach(el => {
            if (isElementInLasso(el, lassoPath)) selected.add(el.id);
          });
          setSelectedElementIds(selected);
          setLassoPath([]);
          setIsDrawing(false);
          return;
        }

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
            setLaserElements(prev => new Map(prev).set(drawEvent.id, { element: drawEvent, opacity: 1 }));
          } else {
            setElements(prev => [...prev, drawEvent]);
          }
          onDrawEvent(drawEvent);
        }

        setIsDrawing(false);
        setCurrentPoints([]);
      }
    },

    onPinch: ({ origin: [cx, cy], movement: [ms], first, memo }) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      
      if (first) {
        return { initialZoom: zoom, initialOffset: { ...offset } };
      }
      
      const { initialZoom, initialOffset } = memo;
      const newZoom = Math.min(Math.max(0.1, initialZoom * ms), 5);
      
      const rect = canvas.getBoundingClientRect();
      const pinchX = cx - rect.left;
      const pinchY = cy - rect.top;
      
      const worldX = (pinchX - initialOffset.x) / initialZoom;
      const worldY = (pinchY - initialOffset.y) / initialZoom;
      
      const newOffsetX = pinchX - worldX * newZoom;
      const newOffsetY = pinchY - worldY * newZoom;
      
      setZoom(newZoom);
      setOffset({ x: newOffsetX, y: newOffsetY });
    },

    onWheel: ({ event, delta: [dx, dy], ctrlKey }) => {
      if (ctrlKey) {
        const canvas = canvasRef.current;
        if (!canvas) return;
        
        const rect = canvas.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        
        const newZoom = Math.min(Math.max(0.1, zoom * (dy > 0 ? 0.9 : 1.1)), 5);
        const scale = newZoom / zoom;
        
        setOffset({
          x: mouseX - (mouseX - offset.x) * scale,
          y: mouseY - (mouseY - offset.y) * scale
        });
        setZoom(newZoom);
      } else {
        // Pan
        setOffset(prev => ({ x: prev.x - dx, y: prev.y - dy }));
      }
    }
  }, {
    drag: { filterTaps: true, threshold: 3 },
    pinch: { scaleBounds: { min: 0.1, max: 5 } },
    eventOptions: { passive: false } 
  });

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
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      
      // Draw selection box around element
      const bounds = getElementBounds(element);
      if (bounds) {
        const { minX, minY, maxX, maxY } = bounds;
        ctx.strokeRect(minX - 5, minY - 5, maxX - minX + 10, maxY - minY + 10);

        // Draw resize handles
        if (options.tool === 'select') {
          const handles = [
            { x: minX - 5, y: minY - 5 }, // tl
            { x: maxX + 5, y: minY - 5 }, // tr
            { x: minX - 5, y: maxY + 5 }, // bl
            { x: maxX + 5, y: maxY + 5 }, // br
          ];

          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = '#2196F3';
          ctx.lineWidth = 2;
          ctx.setLineDash([]);

          handles.forEach(h => {
            ctx.beginPath();
            ctx.arc(h.x, h.y, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          });
        }
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

    // Draw text inside shape if present
    if (element.text && element.tool !== 'text' && points.length >= 2) {
        const bounds = getElementBounds(element);
        if (bounds) {
            const centerX = (bounds.minX + bounds.maxX) / 2;
            const centerY = (bounds.minY + bounds.maxY) / 2;
            
            ctx.save();
            ctx.font = `${element.fontSize || 16}px sans-serif`;
            ctx.fillStyle = element.color; // Use shape color for text too? Or black?
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(element.text, centerX, centerY);
            ctx.restore();
        }
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

  const getResizeHandleAtPoint = (point: Point, element: DrawEvent): ResizeHandle | null => {
    const threshold = 15 / zoom;

    if (element.tool === 'line' || element.tool === 'arrow') {
      const start = element.points[0];
      const end = element.points[element.points.length - 1];
      
      if (Math.abs(point.x - start.x) < threshold && Math.abs(point.y - start.y) < threshold) return 'start';
      if (Math.abs(point.x - end.x) < threshold && Math.abs(point.y - end.y) < threshold) return 'end';
      return null;
    }

    const bounds = getElementBounds(element);
    if (!bounds) return null;

    const { minX, minY, maxX, maxY } = bounds;

    if (Math.abs(point.x - minX) < threshold && Math.abs(point.y - minY) < threshold) return 'tl';
    if (Math.abs(point.x - maxX) < threshold && Math.abs(point.y - minY) < threshold) return 'tr';
    if (Math.abs(point.x - minX) < threshold && Math.abs(point.y - maxY) < threshold) return 'bl';
    if (Math.abs(point.x - maxX) < threshold && Math.abs(point.y - maxY) < threshold) return 'br';

    return null;
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
      // For selection/move, check inside. For eraser, check border.
      if (options.tool === 'select' || options.tool === 'text') {
          return dist <= radius + threshold;
      }
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


  const handleTextSubmit = () => {
    if (!textInputPos) {
      return;
    }

    // If text is empty and we're editing, check if it's a pure text element or a shape
    if (!textInputValue.trim() && editingTextId) {
       const element = elements.find(el => el.id === editingTextId);
       if (element && element.tool === 'text') {
          setElements(prev => prev.filter(el => el.id !== editingTextId));
          onDeleteElement(editingTextId);
       } else if (element) {
          // It's a shape, just clear the text
          const updatedElement = { ...element, text: undefined };
          setElements(prev => prev.map(el => el.id === editingTextId ? updatedElement : el));
          onDrawEvent(updatedElement);
       }
       
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
      // Update existing text or shape text
      const existingElement = elements.find(el => el.id === editingTextId);
      if (existingElement) {
          // If it's a shape (not text tool), update its text property
          if (existingElement.tool !== 'text') {
             const updatedElement = { 
                 ...existingElement, 
                 text: textInputValue,
                 // Optional: update font size relative to shape?
                 fontSize: existingElement.fontSize || 16
             };
             setElements(prev => prev.map(el => el.id === editingTextId ? updatedElement : el));
             onDrawEvent(updatedElement);
          } else {
             // Regular text element
             const drawEvent: DrawEvent = {
               ...existingElement,
               text: textInputValue,
               points: [textInputPos], // Update position in case it moved
               timestamp: Date.now()
             };
             setElements(prev => prev.map(el => el.id === editingTextId ? drawEvent : el));
             onDrawEvent(drawEvent);
          }
      }
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
        {...bind()}
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

