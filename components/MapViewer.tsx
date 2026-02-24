'use client';

import React, { useEffect, useRef } from 'react';
import Matter from 'matter-js';

const MapViewer = () => {
  const sceneRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Matter.Engine | null>(null);
  const renderRef = useRef<Matter.Render | null>(null);
  const runnerRef = useRef<Matter.Runner | null>(null);
  const lastSpawnedBallRef = useRef<Matter.Body | null>(null);

  // Camera Control Logic
  const isUserScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isAutoScrollingRef = useRef(false);

  const handleScroll = () => {
      if (isAutoScrollingRef.current) {
          isAutoScrollingRef.current = false;
          return;
      }
      isUserScrollingRef.current = true;
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = setTimeout(() => {
          isUserScrollingRef.current = false;
      }, 1000);
  };

  const spawnBall = (x: number, y: number) => {
      if (!engineRef.current) return;
      
      const ball = Matter.Bodies.circle(x, y, 15, {
          restitution: 0.8,
          friction: 0.005,
          density: 0.04,
          render: { fillStyle: '#fff' },
          label: 'TestBall'
      });
      Matter.World.add(engineRef.current.world, ball);
      lastSpawnedBallRef.current = ball; // Track this ball
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
      const nativeEvent = e.nativeEvent;
      spawnBall(nativeEvent.offsetX, nativeEvent.offsetY);
  };

  useEffect(() => {
    if (!sceneRef.current) return;

    const Engine = Matter.Engine;
    const Render = Matter.Render;
    const Runner = Matter.Runner;
    const World = Matter.World;
    const Bodies = Matter.Bodies;
    const Events = Matter.Events;
    const Mouse = Matter.Mouse;
    const MouseConstraint = Matter.MouseConstraint;
    const Composite = Matter.Composite;
    const Body = Matter.Body;
    const Collision = Matter.Collision;

    const engine = Engine.create();
    const world = engine.world;
    engine.gravity.y = 0.5;
    engineRef.current = engine;

    const width = 600;
    const height = 1600;

    const render = Render.create({
      element: sceneRef.current,
      engine: engine,
      options: {
        width,
        height,
        wireframes: false,
        background: '#1a1a1a',
      },
    });
    renderRef.current = render;

    // --- Map Construction ---
    const wallOptions = { isStatic: true, render: { fillStyle: '#555' } };
    const leftWall = Bodies.rectangle(10, height / 2, 20, height, wallOptions);
    const rightWall = Bodies.rectangle(width - 10, height / 2, 20, height, wallOptions);
    World.add(world, [leftWall, rightWall]);

    const floorSensor = Bodies.rectangle(width / 2, height - 10, width, 40, {
        isStatic: true,
        isSensor: true, 
        render: { visible: false },
        label: 'FloorSensor'
    });
    World.add(world, floorSensor);

    const pegs: Matter.Body[] = [];
    const rows = 6; const cols = 7;
    const spacingX = 60; const spacingY = 80;

    const createPegBlock = (startY: number) => {
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const offset = row % 2 === 0 ? 0 : 30;
                const x = 100 + col * spacingX + offset;
                const y = startY + row * spacingY;
                if (x > width - 30 || x < 30) continue;
                pegs.push(Bodies.circle(x, y, 8, { isStatic: true, restitution: 0.6, render: { fillStyle: '#6F4E37' } }));
            }
        }
    };
    createPegBlock(150); 
    createPegBlock(950); 
    World.add(world, pegs);

    // Funnel
    const funnelLeft = Bodies.rectangle(100, 1400, 234, 20, { 
        isStatic: true, angle: Math.PI / 6, render: { fillStyle: '#6F4E37' }, friction: 0.05 
    });
    const funnelRight = Bodies.rectangle(500, 1400, 234, 20, { 
        isStatic: true, angle: -Math.PI / 6, render: { fillStyle: '#6F4E37' }, friction: 0.05 
    });
    World.add(world, [funnelLeft, funnelRight]);

    const createCross = (x: number, y: number) => {
        const partA = Bodies.rectangle(x, y, 200, 20, { render: { fillStyle: '#f39c12' } });
        const partB = Bodies.rectangle(x, y, 20, 200, { render: { fillStyle: '#f39c12' } });
        return Body.create({ parts: [partA, partB], isStatic: true });
    };
    const crossTop = createCross(300, 400);
    const crossMiddle = createCross(300, 800);
    const crossBottom = createCross(300, 1200);
    
    const beltOptions = { isStatic: true, render: { fillStyle: '#3498db' }, friction: 0.8 };
    const leftBelt = Bodies.rectangle(100, 850, 180, 20, beltOptions); 
    const rightBelt = Bodies.rectangle(500, 850, 180, 20, beltOptions); 

    // Exit Obstacles (Expanded 1.3x)
    const exitPegs = [
        Bodies.circle(300, 1440, 6, { isStatic: true, restitution: 0.8, render: { fillStyle: '#aaa' } }), // Top
        Bodies.circle(260, 1480, 6, { isStatic: true, restitution: 0.8, render: { fillStyle: '#aaa' } }), // Left
        Bodies.circle(340, 1480, 6, { isStatic: true, restitution: 0.8, render: { fillStyle: '#aaa' } }), // Right
        Bodies.circle(300, 1520, 6, { isStatic: true, restitution: 0.8, render: { fillStyle: '#aaa' } }), // Bottom
    ];

    World.add(world, [crossTop, crossMiddle, crossBottom, leftBelt, rightBelt, ...exitPegs]);

    // --- Dynamic Logic ---
    Events.on(engine, 'beforeUpdate', () => {
        Matter.Body.rotate(crossTop, 0.01);
        Matter.Body.rotate(crossMiddle, -0.01); 
        Matter.Body.rotate(crossBottom, 0.01); 

        const bodies = Composite.allBodies(world);
        bodies.forEach(body => {
            if (body.label === 'TestBall') {
                if (Math.abs(body.velocity.x) < 0.1 && Math.abs(body.velocity.y) < 0.1) {
                    const randomForceX = (Math.random() - 0.5) * 0.005;
                    const forceY = -0.005; 
                    Body.applyForce(body, body.position, { x: randomForceX, y: forceY });
                }
                if (Collision.collides(body, leftBelt)) Body.setVelocity(body, { x: 3, y: body.velocity.y }); 
                if (Collision.collides(body, rightBelt)) Body.setVelocity(body, { x: -3, y: body.velocity.y }); 
            }
        });
    });

    Events.on(engine, 'collisionStart', (event) => {
        const pairs = event.pairs;
        for (let i = 0; i < pairs.length; i++) {
            const { bodyA, bodyB } = pairs[i];
            // Remove on floor hit
            if (bodyA.label === 'FloorSensor' || bodyB.label === 'FloorSensor') {
                const ballBody = bodyA.label === 'FloorSensor' ? bodyB : bodyA;
                if (ballBody.label === 'TestBall') {
                    Composite.remove(world, ballBody);
                    // If tracked ball is removed, stop tracking
                    if (lastSpawnedBallRef.current === ballBody) {
                        lastSpawnedBallRef.current = null;
                    }
                }
            }
        }
    });

    Events.on(render, 'afterRender', () => {
        const ctx = render.context;
        ctx.font = 'bold 24px Arial';
        ctx.fillStyle = 'white';
        ctx.textAlign = 'center';
        ctx.fillText(">> >> >>", 100, 855); 
        ctx.fillText("<< << <<", 500, 855); 
        
        // Auto-Scroll Logic to Last Spawned Ball
        const targetBall = lastSpawnedBallRef.current;
        if (!isUserScrollingRef.current && targetBall && Composite.get(world, targetBall.id, 'body')) {
             if (sceneRef.current && sceneRef.current.parentElement) {
                const container = sceneRef.current.parentElement;
                // Center the ball vertically
                const targetScroll = (targetBall as any).position.y - container.clientHeight / 2;
                isAutoScrollingRef.current = true;
                container.scrollTop = targetScroll;
            }
        }
    });

    // Mouse Interaction (Dragging)
    const mouse = Mouse.create(render.canvas);
    const mouseConstraint = MouseConstraint.create(engine, {
        mouse: mouse,
        constraint: { stiffness: 0.2, render: { visible: false } }
    });
    World.add(world, mouseConstraint);
    render.mouse = mouse;

    Render.run(render);
    const runner = Runner.create();
    runnerRef.current = runner;
    Runner.run(runner, engine);

    return () => {
        Render.stop(render);
        Runner.stop(runner);
        if (render.canvas) render.canvas.remove();
        World.clear(world, false);
        Engine.clear(engine);
    };
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white">
      <h1 className="text-2xl font-bold mb-4">Map Viewer (Dev Mode)</h1>
      <p className="mb-4 text-gray-400">Click to spawn ball (Camera follows last ball). Scroll to unlock.</p>
      <div 
        className="relative w-[600px] h-[80vh] overflow-y-auto border-4 border-gray-700 rounded-lg shadow-2xl bg-gray-800 scrollbar-hide"
        onScroll={handleScroll}
      >
        <div 
            ref={sceneRef} 
            style={{ width: 600, height: 1600 }} 
            onClick={handleCanvasClick} 
        />
      </div>
    </div>
  );
};

export default MapViewer;
