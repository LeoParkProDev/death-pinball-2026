'use client';

import React, { useEffect, useRef, useState } from 'react';
import Matter from 'matter-js';
import { supabase } from '@/lib/supabaseClient';
import { RealtimeChannel } from '@supabase/supabase-js';
import seedrandom from 'seedrandom';

export type Player = {
  id: string;
  name: string;
  color: string;
  colorName: string;
  isHost: boolean;
  isReady: boolean;
};

interface PinballBoardProps {
  players: Player[];
  roomId: string;
  randomSeed: string;
  isHost: boolean;
  myId: string;
  onRestart: () => void;
}

const PinballBoard: React.FC<PinballBoardProps> = ({ players, roomId, randomSeed, isHost, myId, onRestart }) => {
  const sceneRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Matter.Engine | null>(null);
  const renderRef = useRef<Matter.Render | null>(null);
  const runnerRef = useRef<Matter.Runner | null>(null);
  
  const [loser, setLoser] = useState<Player | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const finishedPlayersRef = useRef<Set<string>>(new Set());
  const ballsRef = useRef<Matter.Body[]>([]);

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

  // --- Realtime Sync ---
  useEffect(() => {
      if (!roomId) return;

      const channel = supabase.channel(`room:${roomId}`, {
        config: { 
            broadcast: { self: true },
            presence: { key: myId }
        }
      });

      let syncInterval: NodeJS.Timeout;

      channel
        .on('presence', { event: 'sync' }, () => {
            if (!isHost) {
                const state = channel.presenceState();
                let hostFound = false;
                for (const id in state) {
                    const presences = state[id] as any[];
                    if (presences.some(p => p.isHost === true)) {
                        hostFound = true;
                        break;
                    }
                }
                if (!hostFound && channel.state === 'joined') {
                    alert('Host has left the game. Returning to main menu...');
                    window.location.href = '/';
                }
            }
        })
        .on('broadcast', { event: 'game_loser' }, ({ payload }) => {
            if (payload.loserId) {
                const loserPlayer = players.find(p => p.id === payload.loserId);
                if (loserPlayer) {
                    setLoser(loserPlayer);
                    if (runnerRef.current) Matter.Runner.stop(runnerRef.current);
                }
            }
        })
        .on('broadcast', { event: 'restart_game' }, () => {
            onRestart();
        })
        .on('broadcast', { event: 'sync_state' }, ({ payload }) => {
            if (isHost) return; 

            if (payload.balls && ballsRef.current.length > 0) {
                payload.balls.forEach((syncBall: any) => {
                    const localBall = ballsRef.current.find(b => b.label === syncBall.id);
                    if (localBall) {
                        const dx = localBall.position.x - syncBall.x;
                        const dy = localBall.position.y - syncBall.y;
                        const distance = Math.sqrt(dx * dx + dy * dy);

                        // Threshold for smooth sync: Only snap if drift is significant (> 20px)
                        if (distance > 20) {
                            Matter.Body.setPosition(localBall, { x: syncBall.x, y: syncBall.y });
                            Matter.Body.setVelocity(localBall, { x: syncBall.vx, y: syncBall.vy });
                            Matter.Body.setAngularVelocity(localBall, syncBall.av);
                        } else if (distance > 5) {
                            // Soft correction for minor drift (5px - 20px): Nudge velocity towards target
                            // This is a simple form of linear interpolation via velocity adjustment
                            const correctionX = (syncBall.x - localBall.position.x) * 0.1;
                            const correctionY = (syncBall.y - localBall.position.y) * 0.1;
                            Matter.Body.setVelocity(localBall, { 
                                x: localBall.velocity.x + correctionX, 
                                y: localBall.velocity.y + correctionY 
                            });
                        }
                    }
                });
            }
        })
        .subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
                await channel.track({ isHost });
                if (isHost) {
                    syncInterval = setInterval(() => {
                        if (!ballsRef.current || ballsRef.current.length === 0) return;
                        
                        const ballData = ballsRef.current.map(b => ({
                            id: b.label,
                            x: b.position.x, 
                            y: b.position.y,
                            vx: b.velocity.x,
                            vy: b.velocity.y,
                            av: b.angularVelocity
                        }));

                        channel.send({
                            type: 'broadcast',
                            event: 'sync_state',
                            payload: { balls: ballData }
                        });
                    }, 50);
                }
            }
        });

      channelRef.current = channel;

      return () => {
          supabase.removeChannel(channel);
          if (syncInterval) clearInterval(syncInterval);
      };
  }, [roomId, players, onRestart, isHost]);


  // --- Physics Engine ---
  useEffect(() => {
    if (!sceneRef.current || players.length === 0) return;
    if (loser) return; 

    finishedPlayersRef.current = new Set();
    const rng = seedrandom(randomSeed);

    const Engine = Matter.Engine;
    const Render = Matter.Render;
    const Runner = Matter.Runner;
    const World = Matter.World;
    const Bodies = Matter.Bodies;
    const Events = Matter.Events;
    const Composite = Matter.Composite;
    const Body = Matter.Body;
    const Collision = Matter.Collision; 
    const Vector = Matter.Vector;

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
    
    // Setup sync listener again to use local variables/references if needed, 
    // but the main sync logic is in the other useEffect. 
    // Actually, we need to move the sync handler logic HERE or expose 'balls' to the other effect properly.
    // The current structure has 'ballsRef' updated in the initialization, so the other effect works fine.
    // We just need to update the sync handler in the FIRST useEffect to implement the threshold.
    
    // ... (rest of physics setup is fine) ...


    // --- 2. Walls ---
    const wallOptions = { isStatic: true, render: { fillStyle: '#555' } };
    const leftWall = Bodies.rectangle(10, height / 2, 20, height, wallOptions);
    const rightWall = Bodies.rectangle(width - 10, height / 2, 20, height, wallOptions);
    World.add(world, [leftWall, rightWall]);

    // --- 3. Floor Sensor ---
    const floorSensor = Bodies.rectangle(width / 2, height - 10, width, 40, {
      isStatic: true,
      isSensor: true, 
      render: { visible: false },
      label: 'FloorSensor'
    });
    World.add(world, floorSensor);

    // --- 4. Map Design ---
    
    // 4.1 Pegs
    const pegs: Matter.Body[] = [];
    const rows = 6; 
    const cols = 7;
    const spacingX = 60;
    const spacingY = 80;

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

    // 4.2 Funnel
    const funnelLeft = Bodies.rectangle(100, 1400, 234, 20, { 
        isStatic: true, angle: Math.PI / 6, render: { fillStyle: '#6F4E37' }, friction: 0.05 
    });
    const funnelRight = Bodies.rectangle(500, 1400, 234, 20, { 
        isStatic: true, angle: -Math.PI / 6, render: { fillStyle: '#6F4E37' }, friction: 0.05 
    });
    World.add(world, [funnelLeft, funnelRight]);

    // 4.3 Cross Propellers
    const createCross = (x: number, y: number) => {
        const partA = Bodies.rectangle(x, y, 200, 20, { render: { fillStyle: '#f39c12' } });
        const partB = Bodies.rectangle(x, y, 20, 200, { render: { fillStyle: '#f39c12' } });
        return Body.create({ parts: [partA, partB], isStatic: true });
    };
    const crossTop = createCross(300, 400);
    const crossMiddle = createCross(300, 800);
    const crossBottom = createCross(300, 1200);
    
    // 4.4 Conveyor Belts
    const beltOptions = { 
        isStatic: true, 
        render: { fillStyle: '#3498db' },
        friction: 0.8 
    };
    const leftBelt = Bodies.rectangle(100, 850, 180, 20, beltOptions); 
    const rightBelt = Bodies.rectangle(500, 850, 180, 20, beltOptions); 

    // 4.5 Exit Obstacles (Expanded 1.1x more)
    const exitPegs = [
        Bodies.circle(300, 1436, 6, { isStatic: true, restitution: 0.8, render: { fillStyle: '#aaa' } }), // Top
        Bodies.circle(256, 1480, 6, { isStatic: true, restitution: 0.8, render: { fillStyle: '#aaa' } }), // Left
        Bodies.circle(344, 1480, 6, { isStatic: true, restitution: 0.8, render: { fillStyle: '#aaa' } }), // Right
        Bodies.circle(300, 1524, 6, { isStatic: true, restitution: 0.8, render: { fillStyle: '#aaa' } }), // Bottom
    ];

    World.add(world, [crossTop, crossMiddle, crossBottom, leftBelt, rightBelt, ...exitPegs]);


    // --- 5. Balls ---
    const ballOptions = (color: string, label: string) => ({
      restitution: 0.8, friction: 0.005, density: 0.04, render: { fillStyle: color }, label: label
    });
    const ballRadius = 15; 
    const dropY = 50; 
    
    const balls = players.map((player, index) => {
        const startX = 200 + index * 50;
        const jitterX = (rng() - 0.5) * 2; 
        const jitterY = (rng() - 0.5) * 2;
        return Bodies.circle(startX + jitterX, dropY + jitterY, ballRadius, ballOptions(player.color, player.id));
    });
    World.add(world, balls);
    ballsRef.current = balls;

    // --- 6. Anti-Stuck & Rotation & Belts ---
    Events.on(engine, 'beforeUpdate', () => {
        // Rotate Propellers
        Matter.Body.rotate(crossTop, 0.01);
        Matter.Body.rotate(crossMiddle, -0.01); 
        Matter.Body.rotate(crossBottom, 0.01); 

        balls.forEach((ball) => {
            // Anti-Stuck
            if (Math.abs(ball.velocity.x) < 0.1 && Math.abs(ball.velocity.y) < 0.1) {
                const randomForceX = (rng() - 0.5) * 0.005;
                const forceY = -0.005; 
                Body.applyForce(ball, ball.position, { x: randomForceX, y: forceY });
            }

            // Conveyor Belt Logic
            if (Collision.collides(ball, leftBelt)) {
                Body.setVelocity(ball, { x: 3, y: ball.velocity.y }); 
            }
            if (Collision.collides(ball, rightBelt)) {
                Body.setVelocity(ball, { x: -3, y: ball.velocity.y }); 
            }
        });
    });

    // Camera & Names & Arrows
    Events.on(render, 'afterRender', () => {
        const ctx = render.context;
        ctx.font = 'bold 14px Arial';
        ctx.fillStyle = 'white';
        ctx.textAlign = 'center';

        // Draw Arrows
        ctx.font = 'bold 24px Arial';
        ctx.fillText(">> >> >>", 100, 855); 
        ctx.fillText("<< << <<", 500, 855); 
        ctx.font = 'bold 14px Arial';

        let myBall = null;
        balls.forEach((ball, index) => {
            const player = players[index];
            if (player && Composite.get(world, ball.id, 'body')) {
                ctx.fillText(player.name, ball.position.x, ball.position.y - 25);
                if (player.id === myId) myBall = ball;
            }
        });

        if (!isUserScrollingRef.current && myBall && sceneRef.current && sceneRef.current.parentElement) {
            const container = sceneRef.current.parentElement;
            const targetScroll = (myBall as any).position.y - container.clientHeight / 2;
            isAutoScrollingRef.current = true;
            container.scrollTop = targetScroll;
        }
    });

    // 7. Collision Event
    Events.on(engine, 'collisionStart', (event) => {
      if (!isHost) return;
      const pairs = event.pairs;
      for (let i = 0; i < pairs.length; i++) {
        const { bodyA, bodyB } = pairs[i];
        if (bodyA.label === 'FloorSensor' || bodyB.label === 'FloorSensor') {
          const ballBody = bodyA.label === 'FloorSensor' ? bodyB : bodyA;
          if (ballBody.label && ballBody.label !== 'FloorSensor') {
             const playerId = ballBody.label;
             if (finishedPlayersRef.current.has(playerId)) continue;
             finishedPlayersRef.current.add(playerId);
             Composite.remove(world, ballBody);

             // Last Man Standing Logic
             const threshold = players.length > 1 ? players.length - 1 : 1;

             if (finishedPlayersRef.current.size === threshold) {
                 let winnerPlayer: Player | undefined;
                 if (players.length > 1) {
                     winnerPlayer = players.find(p => !finishedPlayersRef.current.has(p.id));
                 } else {
                     winnerPlayer = players[0];
                 }
                 
                 if (winnerPlayer) {
                     setLoser(winnerPlayer);
                     Matter.Runner.stop(runner); 
                     if (channelRef.current) {
                         channelRef.current.send({
                             type: 'broadcast',
                             event: 'game_loser',
                             payload: { loserId: winnerPlayer.id }
                         });
                     }
                 }
             }
          }
        }
      }
    });

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
  }, [players, randomSeed, isHost, myId]); 

  // --- UI ---
  return (
    <div className="flex flex-col items-center min-h-screen bg-gray-900 text-white relative">
      
      {/* Sticky Header: Players */}
      <div className="sticky top-0 z-20 w-full bg-gray-900/90 backdrop-blur-md border-b border-gray-800 p-4 shadow-lg flex justify-center">
        <div className="flex gap-4">
            {players.map(p => (
                <div key={p.id} className="flex items-center gap-2 px-3 py-1 rounded-full bg-gray-800 border border-gray-700">
                    <div className="w-4 h-4 rounded-full" style={{ backgroundColor: p.color }} />
                    <span className={loser?.id === p.id ? 'font-bold text-yellow-400 underline' : 'text-gray-300 font-medium'}>
                        {p.name}
                    </span>
                </div>
            ))}
        </div>
      </div>

      <div 
        className="relative w-[600px] h-[80vh] mt-4 overflow-y-auto border-4 border-gray-700 rounded-lg shadow-2xl bg-gray-800 scrollbar-hide"
        onScroll={handleScroll} 
      >
        <div ref={sceneRef} style={{ width: 600, height: 1600 }} />
        {loser && (
           <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm z-30 p-8 text-center animate-fade-in fixed top-0 left-0 w-full h-full">
             <div className="w-32 h-32 rounded-full mb-6 border-8 border-yellow-400 shadow-2xl animate-bounce flex items-center justify-center bg-black">
                 <span className="text-6xl">🏆</span>
             </div>
             <h2 className="text-6xl font-black text-white mb-2 drop-shadow-lg">WIN!</h2>
             <h3 className="text-4xl font-bold text-yellow-400 mb-8">{loser.name}</h3>
             {isHost ? (<button onClick={() => { if (channelRef.current) { channelRef.current.send({ type: 'broadcast', event: 'restart_game', payload: {} }); } onRestart(); }} className="px-8 py-3 bg-gradient-to-r from-yellow-500 to-orange-500 text-white font-bold text-xl rounded-full hover:scale-105 transition transform shadow-lg">Play Again</button>) : (<p className="text-yellow-200 animate-pulse font-bold text-xl">Waiting for Host to restart...</p>)}
           </div>
        )}
      </div>
    </div>
  );
};

export default PinballBoard;