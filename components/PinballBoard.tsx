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

  // --- Realtime Sync ---
  useEffect(() => {
      if (!roomId) return;

      const channel = supabase.channel(`room:${roomId}`, {
        config: { broadcast: { self: true } }
      });

      let syncInterval: NodeJS.Timeout;

      channel
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
                        Matter.Body.setPosition(localBall, { x: syncBall.x, y: syncBall.y });
                        Matter.Body.setVelocity(localBall, { x: syncBall.vx, y: syncBall.vy });
                        Matter.Body.setAngularVelocity(localBall, syncBall.av);
                    }
                });
            }
        })
        .subscribe((status) => {
            if (status === 'SUBSCRIBED' && isHost) {
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
                }, 1000);
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

    const engine = Engine.create();
    const world = engine.world;
    
    // Gravity tweak
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

    // --- 2. Walls ---
    const wallOptions = { isStatic: true, render: { fillStyle: '#555' } };
    const leftWall = Bodies.rectangle(10, height / 2, 20, height, wallOptions);
    const rightWall = Bodies.rectangle(width - 10, height / 2, 20, height, wallOptions);
    World.add(world, [leftWall, rightWall]);

    // --- 3. Floor Sensor ---
    const floorSensor = Bodies.rectangle(width / 2, height - 10, width, 20, {
      isStatic: true,
      isSensor: true, 
      render: { visible: false },
      label: 'FloorSensor'
    });
    World.add(world, floorSensor);

    // --- 4. Map Design: Pegs & Funnel ---
    
    // 4.1 Pegs (Top & Bottom Sections)
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

                pegs.push(
                    Bodies.circle(x, y, 8, {
                        isStatic: true,
                        restitution: 0.6,
                        render: { fillStyle: '#6F4E37' }
                    })
                );
            }
        }
    };

    createPegBlock(150); 
    createPegBlock(950); 

    World.add(world, pegs);

    // 4.2 Funnel (Bottom Suspense)
    const funnelLeft = Bodies.rectangle(80, 1450, 360, 20, { 
        isStatic: true, 
        angle: Math.PI / 6, 
        render: { fillStyle: '#6F4E37' },
        friction: 0.05
    });
    
    const funnelRight = Bodies.rectangle(520, 1450, 360, 20, { 
        isStatic: true, 
        angle: -Math.PI / 6, 
        render: { fillStyle: '#6F4E37' },
        friction: 0.05
    });
    
    World.add(world, [funnelLeft, funnelRight]);

    // 4.3 Cross Propellers
    const createCross = (x: number, y: number) => {
        const partA = Bodies.rectangle(x, y, 200, 20, { render: { fillStyle: '#f39c12' } });
        const partB = Bodies.rectangle(x, y, 20, 200, { render: { fillStyle: '#f39c12' } });
        return Body.create({ parts: [partA, partB], isStatic: true });
    };

    const crossTop = createCross(300, 400);
    const crossBottom = createCross(300, 1200);
    
    World.add(world, [crossTop, crossBottom]);


    // --- 5. Balls (From Players) ---
    const ballOptions = (color: string, label: string) => ({
      restitution: 0.8, 
      friction: 0.005,  
      density: 0.04,    
      render: { fillStyle: color },
      label: label
    });

    const ballRadius = 15; 
    const dropY = 50; 
    
    const balls = players.map((player, index) => {
        const startX = 200 + index * 50;
        const jitterX = (rng() - 0.5) * 2; 
        const jitterY = (rng() - 0.5) * 2;

        return Bodies.circle(
            startX + jitterX, 
            dropY + jitterY, 
            ballRadius, 
            ballOptions(player.color, player.id)
        );
    });
    
    World.add(world, balls);
    ballsRef.current = balls;

    // --- 6. Anti-Stuck Logic & Rotation & Camera ---
    Events.on(engine, 'beforeUpdate', () => {
        // Rotate Propellers
        Matter.Body.rotate(crossTop, 0.02);
        Matter.Body.rotate(crossBottom, -0.02); 

        balls.forEach((ball) => {
            if (Math.abs(ball.velocity.x) < 0.1 && Math.abs(ball.velocity.y) < 0.1) {
                const randomForceX = (rng() - 0.5) * 0.005;
                const forceY = -0.005; 
                Body.applyForce(ball, ball.position, { x: randomForceX, y: forceY });
            }
        });
    });

    // Camera follow & Name drawing
    Events.on(render, 'afterRender', () => {
        const ctx = render.context;
        ctx.font = 'bold 14px Arial';
        ctx.fillStyle = 'white';
        ctx.textAlign = 'center';

        // Find my ball for camera follow
        let myBall = null;

        balls.forEach((ball, index) => {
            const player = players[index];
            if (player && Composite.get(world, ball.id, 'body')) {
                // Draw name
                ctx.fillText(player.name, ball.position.x, ball.position.y - 25);
                
                // Identify my ball
                if (player.id === myId) {
                    myBall = ball;
                }
            }
        });

        // Scroll to my ball
        if (myBall && sceneRef.current && sceneRef.current.parentElement) {
            const container = sceneRef.current.parentElement;
            const targetScroll = (myBall as any).position.y - container.clientHeight / 2;
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

             if (finishedPlayersRef.current.size === players.length) {
                 const loserPlayer = players.find(p => p.id === playerId);
                 
                 if (loserPlayer) {
                     setLoser(loserPlayer);
                     Matter.Runner.stop(runner); 
                     
                     if (channelRef.current) {
                         channelRef.current.send({
                             type: 'broadcast',
                             event: 'game_loser',
                             payload: { loserId: loserPlayer.id }
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
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white relative">
      <h1 className="text-3xl font-bold mb-4">Death Pinball (Last One Wins!)</h1>
      
      <div className="relative w-[600px] h-[80vh] overflow-y-auto border-4 border-gray-700 rounded-lg shadow-2xl bg-gray-800 scrollbar-hide">
        <div 
          ref={sceneRef} 
          style={{ width: 600, height: 1600 }}
        />
        
        {loser && (
           <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm z-10 p-8 text-center animate-fade-in fixed top-0 left-0 w-full h-full">
             <div 
                className="w-32 h-32 rounded-full mb-6 border-8 border-yellow-400 shadow-2xl animate-bounce flex items-center justify-center bg-black"
             >
                 <span className="text-6xl">🏆</span>
             </div>
             <h2 className="text-6xl font-black text-white mb-2 drop-shadow-lg">
               WIN!
             </h2>
             <h3 className="text-4xl font-bold text-yellow-400 mb-8">
               {loser.name}
             </h3>
             
             {isHost ? (
                <button 
                onClick={() => {
                    if (channelRef.current) {
                        channelRef.current.send({
                            type: 'broadcast',
                            event: 'restart_game',
                            payload: {}
                        });
                    }
                    onRestart();
                }}
                className="px-8 py-3 bg-gradient-to-r from-yellow-500 to-orange-500 text-white font-bold text-xl rounded-full hover:scale-105 transition transform shadow-lg"
                >
                Play Again
                </button>
             ) : (
                 <p className="text-yellow-200 animate-pulse font-bold text-xl">Waiting for Host to restart...</p>
             )}
           </div>
        )}
      </div>

      <div className="mt-6 flex gap-4">
        {players.map(p => (
            <div key={p.id} className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-full" style={{ backgroundColor: p.color }} />
                <span className={loser?.id === p.id ? 'font-bold text-yellow-400 underline' : 'text-gray-400'}>
                    {p.name}
                </span>
            </div>
        ))}
      </div>
    </div>
  );
};

export default PinballBoard;