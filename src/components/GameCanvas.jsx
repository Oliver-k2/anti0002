import React, { useRef, useEffect, useState, memo } from 'react';
import { ref, onChildAdded, onChildChanged, onChildRemoved, onDisconnect, set, update, remove, get } from 'firebase/database';
import { db } from '../firebase';
import { throttle } from 'lodash';

const TILE_SIZE = 12; 
const WORLD_WIDTH = 2500;
const WORLD_HEIGHT = 2000;

const GameCanvas = ({ user, isMobile }) => {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [leaderboard, setLeaderboard] = useState([]);
  
  const playersRef = useRef(new Map());
  const tilesRef = useRef(new Map()); 
  const monstersRef = useRef(new Map());

  const worldCanvasRef = useRef(null);

  const myPos = useRef({ 
    x: user.isAdmin ? WORLD_WIDTH / 2 : Math.floor((Math.random() * WORLD_WIDTH)/TILE_SIZE) * TILE_SIZE, 
    y: user.isAdmin ? WORLD_HEIGHT / 2 : Math.floor((Math.random() * WORLD_HEIGHT)/TILE_SIZE) * TILE_SIZE 
  });

  const keysRef = useRef({ ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false, w: false, a: false, s: false, d: false });

  const syncPositionToFirebase = useRef(
    throttle((pos) => {
      update(ref(db, `players/${user.uid}`), { 
        uid: user.uid, nickname: user.nickname, color: user.color, x: pos.x, y: pos.y 
      }).catch(() => {});
    }, 100)
  ).current;

  const killPlayer = (targetUid) => {
    const deathUpdates = {};
    tilesRef.current.forEach((t, k) => {
      if (t.uid === targetUid) deathUpdates[`tiles/${k}`] = null;
    });
    deathUpdates[`players/${targetUid}`] = null;
    update(ref(db), deathUpdates).catch(console.error);
  };

  const die = () => {
    alert("사망했습니다!");
    remove(ref(db, `players/${user.uid}`));
    const deathUpdates = {};
    tilesRef.current.forEach((t, k) => {
      if (t.uid === user.uid) deathUpdates[k] = null;
    });
    update(ref(db, 'tiles'), deathUpdates);
  };

  const checkEnclosure = useRef(
    throttle(() => {
      if (user.isAdmin) return;
      const MAX_X = Math.ceil(WORLD_WIDTH / TILE_SIZE) + 2;
      const MAX_Y = Math.ceil(WORLD_HEIGHT / TILE_SIZE) + 2;
      const R = MAX_Y + 2;
      const C = MAX_X + 2;
      const grid = new Uint8Array(R * C); 
      const getIdx = (x, y) => y * C + x;

      tilesRef.current.forEach(tile => {
        if (tile.uid === user.uid) {
          const gx = Math.round(tile.x / TILE_SIZE);
          const gy = Math.round(tile.y / TILE_SIZE);
          if (gx >= 0 && gx < MAX_X && gy >= 0 && gy < MAX_Y) {
            grid[getIdx(gx + 1, gy + 1)] = 1;
          }
        }
      });

      const queue = new Int32Array(R * C * 2);
      let head = 0, tail = 0;
      queue[tail++] = 0; queue[tail++] = 0;
      grid[getIdx(0, 0)] = 2;

      while(head < tail) {
        const cx = queue[head++]; const cy = queue[head++];
        if (cx > 0 && grid[getIdx(cx - 1, cy)] === 0) { grid[getIdx(cx - 1, cy)] = 2; queue[tail++] = cx - 1; queue[tail++] = cy; }
        if (cx < C - 1 && grid[getIdx(cx + 1, cy)] === 0) { grid[getIdx(cx + 1, cy)] = 2; queue[tail++] = cx + 1; queue[tail++] = cy; }
        if (cy > 0 && grid[getIdx(cx, cy - 1)] === 0) { grid[getIdx(cx, cy - 1)] = 2; queue[tail++] = cx; queue[tail++] = cy - 1; }
        if (cy < R - 1 && grid[getIdx(cx, cy + 1)] === 0) { grid[getIdx(cx, cy + 1)] = 2; queue[tail++] = cx; queue[tail++] = cy + 1; }
      }

      const updates = {};
      let enclosedCount = 0;

      tilesRef.current.forEach((t, k) => {
         if (t.uid === user.uid && t.type === 'trail') {
            updates[k] = { uid: user.uid, color: user.color, nickname: user.nickname, type: 'base', x: t.x, y: t.y };
            enclosedCount++;
         }
      });

      for (let y = 0; y < MAX_Y; y++) {
        for (let x = 0; x < MAX_X; x++) {
          if (grid[getIdx(x + 1, y + 1)] === 0) {
            const realX = x * TILE_SIZE; const realY = y * TILE_SIZE;
            if (realX > WORLD_WIDTH || realY > WORLD_HEIGHT) continue;
            const tileKey = `${realX}_${realY}`;
            const existing = tilesRef.current.get(tileKey);
            if (!existing || existing.uid !== user.uid) {
              updates[tileKey] = { uid: user.uid, color: user.color, nickname: user.nickname, type: 'base', x: realX, y: realY };
              enclosedCount++;
            }
          }
        }
      }

      playersRef.current.forEach(p => {
         if (p.uid !== user.uid && !p.isAdmin) {
            const pk = `${p.x}_${p.y}`;
            if (updates[pk]) killPlayer(p.uid);
         }
      });

      monstersRef.current.forEach(m => {
         const mx = Math.round(m.x / TILE_SIZE) * TILE_SIZE;
         const my = Math.round(m.y / TILE_SIZE) * TILE_SIZE;
         if (updates[`${mx}_${my}`]) remove(ref(db, `monsters/${m.id}`));
      });

      if (enclosedCount > 0) update(ref(db, 'tiles'), updates).catch(console.error);
    }, 300, { leading: false, trailing: true })
  ).current;

  const paintTile = (x, y, type) => {
    if (user.isAdmin) return;
    const tileKey = `${x}_${y}`;
    const newTile = { uid: user.uid, color: user.color, nickname: user.nickname, type, x, y };
    update(ref(db, 'tiles'), { [tileKey]: newTile }).catch(console.error);
  };

  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.width = WORLD_WIDTH;
    canvas.height = WORLD_HEIGHT;
    worldCanvasRef.current = canvas;

    const handleResize = () => {
      if (canvasRef.current && containerRef.current) {
        canvasRef.current.width = containerRef.current.clientWidth;
        canvasRef.current.height = containerRef.current.clientHeight;
      }
    };
    window.addEventListener('resize', handleResize);
    setTimeout(handleResize, 100);
    return () => window.removeEventListener('resize', handleResize);
  }, [isMobile]);

  useEffect(() => {
    let myPlayerRef = null;
    let myApprovalRef = null;
    if (!user.isAdmin) {
      myPlayerRef = ref(db, `players/${user.uid}`);
      set(myPlayerRef, { uid: user.uid, nickname: user.nickname, color: user.color, x: myPos.current.x, y: myPos.current.y });
      onDisconnect(myPlayerRef).remove();

      myApprovalRef = ref(db, `approvals/${user.uid}`);
      onDisconnect(myApprovalRef).remove();

      const initBase = {};
      for(let dy=-1; dy<=1; dy++){
        for(let dx=-1; dx<=1; dx++){
           const bx = myPos.current.x + dx*TILE_SIZE;
           const by = myPos.current.y + dy*TILE_SIZE;
           initBase[`${bx}_${by}`] = { x: bx, y: by, uid: user.uid, color: user.color, nickname: user.nickname, type: 'base' };
        }
      }
      update(ref(db, 'tiles'), initBase);
    }

    const handlePlayerAdded = snap => playersRef.current.set(snap.key, snap.val());
    const handlePlayerChanged = snap => playersRef.current.set(snap.key, snap.val());
    const handlePlayerRemoved = snap => playersRef.current.delete(snap.key);
    
    onChildAdded(ref(db, 'players'), handlePlayerAdded);
    onChildChanged(ref(db, 'players'), handlePlayerChanged);
    onChildRemoved(ref(db, 'players'), handlePlayerRemoved);

    const drawToBaseCanvas = (tile) => {
      if (tile.type === 'base' && worldCanvasRef.current) {
        const wctx = worldCanvasRef.current.getContext('2d');
        wctx.fillStyle = tile.color;
        wctx.fillRect(tile.x, tile.y, TILE_SIZE, TILE_SIZE);
      }
    };

    const handleTileAdded = snap => {
      const tile = snap.val();
      if(tile.x === undefined) { const [x,y] = snap.key.split('_'); tile.x = parseInt(x); tile.y = parseInt(y); tile.type = 'base'; }
      tilesRef.current.set(snap.key, tile);
      drawToBaseCanvas(tile);
    };
    const handleTileChanged = snap => {
      const tile = snap.val();
      if(tile.x === undefined) { const [x,y] = snap.key.split('_'); tile.x = parseInt(x); tile.y = parseInt(y); tile.type = 'base'; }
      tilesRef.current.set(snap.key, tile);
      drawToBaseCanvas(tile);
    };
    const handleTileRemoved = snap => {
      const tile = tilesRef.current.get(snap.key);
      if(!tile) return;
      tilesRef.current.delete(snap.key);
      if (tile.type === 'base' && worldCanvasRef.current) {
        const wctx = worldCanvasRef.current.getContext('2d');
        wctx.clearRect(tile.x, tile.y, TILE_SIZE, TILE_SIZE);
      }
    };
    
    const tilesDbRef = ref(db, 'tiles');
    get(tilesDbRef).then(snapshot => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        Object.keys(data).forEach(k => {
          const tile = data[k];
          if(tile.x === undefined) { const [x,y] = k.split('_'); tile.x = parseInt(x); tile.y = parseInt(y); tile.type = 'base'; }
          tilesRef.current.set(k, tile);
          drawToBaseCanvas(tile);
        });
      }
      onChildAdded(tilesDbRef, handleTileAdded);
      onChildChanged(tilesDbRef, handleTileChanged);
      onChildRemoved(tilesDbRef, handleTileRemoved);
    });

    onChildAdded(ref(db, 'monsters'), snap => monstersRef.current.set(snap.key, { id: snap.key, ...snap.val() }));
    onChildChanged(ref(db, 'monsters'), snap => monstersRef.current.set(snap.key, { id: snap.key, ...snap.val() }));
    onChildRemoved(ref(db, 'monsters'), snap => monstersRef.current.delete(snap.key));

    return () => { 
      if (myPlayerRef) remove(myPlayerRef); 
      if (myApprovalRef) remove(myApprovalRef);
    };
  }, [user.uid, user.isAdmin]);

  useEffect(() => {
     if (!user.isAdmin) return;
     let interval = setInterval(() => {
        if (monstersRef.current.size < 5) {
           const id = 'mon_' + Math.random().toString(36).substr(2,9);
           const mx = Math.floor(Math.random() * (WORLD_WIDTH / TILE_SIZE)) * TILE_SIZE;
           const my = Math.floor(Math.random() * (WORLD_HEIGHT / TILE_SIZE)) * TILE_SIZE;
           const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
           set(ref(db, `monsters/${id}`), { x: mx, y: my, dx: dirs[0][0], dy: dirs[0][1] });
        }
        const updates = {};
        monstersRef.current.forEach(m => {
            let nextX = m.x + m.dx * TILE_SIZE; 
            let nextY = m.y + m.dy * TILE_SIZE;
            if (nextX < 0 || nextX >= WORLD_WIDTH || nextY < 0 || nextY >= WORLD_HEIGHT) {
                m.dx *= -1; m.dy *= -1;
            } else {
                const alignX = Math.round(nextX / TILE_SIZE) * TILE_SIZE;
                const alignY = Math.round(nextY / TILE_SIZE) * TILE_SIZE;
                if (tilesRef.current.has(`${alignX}_${alignY}`)) {
                    const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
                    const newDir = dirs[Math.floor(Math.random()*4)];
                    m.dx = newDir[0]; m.dy = newDir[1];
                } else {
                    m.x = nextX; m.y = nextY;
                }
            }
            updates[`monsters/${m.id}`] = { x: m.x, y: m.y, dx: m.dx, dy: m.dy };
        });
        if (Object.keys(updates).length > 0) update(ref(db), updates);
     }, 150);
     return () => clearInterval(interval);
  }, [user.isAdmin]);

  useEffect(() => {
    const calcLeaderboard = setInterval(() => {
      const scoreMap = new Map();
      tilesRef.current.forEach(tile => {
        if (tile.type !== 'base') return;
        if (!scoreMap.has(tile.uid)) scoreMap.set(tile.uid, { nickname: tile.nickname, count: 0, color: tile.color });
        scoreMap.get(tile.uid).count += 1;
      });
      const sortedLeaderboard = Array.from(scoreMap.values()).sort((a, b) => b.count - a.count).slice(0, 5);
      setLeaderboard(sortedLeaderboard);
    }, 1000);
    return () => clearInterval(calcLeaderboard);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => { 
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) e.preventDefault();
      keysRef.current[e.key] = true; 
    };
    const handleKeyUp = (e) => { keysRef.current[e.key] = false; };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    let moveRaf;
    const moveLoop = () => {
      let moved = false;
      const speed = user.isAdmin ? TILE_SIZE * 3 : TILE_SIZE;
      const newPos = { ...myPos.current };
      const keys = keysRef.current;
      
      if ((keys['w'] || keys['ArrowUp']) && newPos.y > 0) { newPos.y -= speed; moved = true; }
      else if ((keys['s'] || keys['ArrowDown']) && newPos.y < WORLD_HEIGHT - TILE_SIZE) { newPos.y += speed; moved = true; }
      else if ((keys['a'] || keys['ArrowLeft']) && newPos.x > 0) { newPos.x -= speed; moved = true; }
      else if ((keys['d'] || keys['ArrowRight']) && newPos.x < WORLD_WIDTH - TILE_SIZE) { newPos.x += speed; moved = true; }

      if (moved) {
        myPos.current = newPos;
        if (!user.isAdmin) {
          const nextTileKey = `${newPos.x}_${newPos.y}`;
          const nextTile = tilesRef.current.get(nextTileKey);

          let amIInBase = (nextTile && nextTile.uid === user.uid && nextTile.type === 'base');
          
          if (nextTile && nextTile.type === 'trail') {
             if (nextTile.uid === user.uid) { die(); return; }
             else killPlayer(nextTile.uid);
          }

          let hitMonster = false;
          monstersRef.current.forEach(m => {
             if (Math.abs(m.x - newPos.x) < TILE_SIZE && Math.abs(m.y - newPos.y) < TILE_SIZE) hitMonster = true;
          });
          if (hitMonster) { die(); return; }

          if (!amIInBase) {
             paintTile(newPos.x, newPos.y, 'trail');
          } else {
             let haveTrail = false;
             tilesRef.current.forEach(t => { if(t.uid === user.uid && t.type === 'trail') haveTrail = true; });
             if (haveTrail) checkEnclosure();
             else syncPositionToFirebase(newPos);
          }
        }
      }
      moveRaf = setTimeout(moveLoop, 60);
    };
    moveLoop();

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      clearTimeout(moveRaf);
    };
  }, [user.isAdmin]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    let renderRafId;

    const render = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#020617'; 
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const cameraX = Math.floor(canvas.width / 2) - myPos.current.x;
      const cameraY = Math.floor(canvas.height / 2) - myPos.current.y;
      ctx.translate(cameraX, cameraY);
      
      const viewportXLeft = myPos.current.x - canvas.width / 2;
      const viewportXRight = myPos.current.x + canvas.width / 2;
      const viewportYTop = myPos.current.y - canvas.height / 2;
      const viewportYBottom = myPos.current.y + canvas.height / 2;

      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 4;
      ctx.strokeRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

      if (worldCanvasRef.current) {
        ctx.drawImage(worldCanvasRef.current, 0, 0);
      }

      tilesRef.current.forEach((tile) => {
        if (tile.type === 'trail') {
          if (tile.x + TILE_SIZE >= viewportXLeft && tile.x <= viewportXRight && tile.y + TILE_SIZE >= viewportYTop && tile.y <= viewportYBottom) {
            ctx.globalAlpha = 0.6;
            ctx.fillStyle = tile.color;
            ctx.fillRect(tile.x + 2, tile.y + 2, TILE_SIZE - 4, TILE_SIZE - 4); 
            ctx.globalAlpha = 1.0;
          }
        }
      });

      monstersRef.current.forEach(m => {
          ctx.fillStyle = '#ff0000';
          ctx.shadowBlur = 10; ctx.shadowColor = '#ff0000';
          ctx.fillRect(m.x - 2, m.y - 2, TILE_SIZE + 4, TILE_SIZE + 4);
          ctx.shadowBlur = 0;
      });

      playersRef.current.forEach((player) => {
        if (player.x + TILE_SIZE < viewportXLeft || player.x > viewportXRight || player.y + TILE_SIZE < viewportYTop || player.y > viewportYBottom) return;
        ctx.shadowBlur = 10; ctx.shadowColor = player.color;
        ctx.fillStyle = '#ffffff'; ctx.fillRect(player.x - 1, player.y - 1, TILE_SIZE + 2, TILE_SIZE + 2);
        ctx.fillStyle = player.color; ctx.fillRect(player.x, player.y, TILE_SIZE, TILE_SIZE);
        ctx.shadowBlur = 0;
        ctx.font = 'bold 12px Outfit, sans-serif'; ctx.textAlign = 'center';
        const textWidth = ctx.measureText(player.nickname).width;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.9)'; ctx.fillRect(player.x + TILE_SIZE / 2 - textWidth / 2 - 6, player.y - 22, textWidth + 12, 16);
        ctx.fillStyle = 'white'; ctx.fillText(player.nickname, player.x + TILE_SIZE / 2, player.y - 10);
      });

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      
      const minimapSize = isMobile ? 120 : 180;
      const minimapScale = minimapSize / Math.max(WORLD_WIDTH, WORLD_HEIGHT);
      const padding = isMobile ? 12 : 24;
      const mmX = padding;
      const mmY = canvas.height - minimapSize - padding;

      ctx.save();
      ctx.beginPath();
      ctx.roundRect(mmX, mmY, minimapSize, minimapSize, 12);
      ctx.clip();
      ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
      ctx.fillRect(mmX, mmY, minimapSize, minimapSize);

      if (worldCanvasRef.current) {
        ctx.drawImage(worldCanvasRef.current, 0, 0, WORLD_WIDTH, WORLD_HEIGHT, mmX, mmY, minimapSize, minimapSize);
      }
      
      playersRef.current.forEach((player) => {
        ctx.fillStyle = player.color; ctx.beginPath();
        ctx.arc(mmX + player.x * minimapScale, mmY + player.y * minimapScale, 3, 0, Math.PI * 2);
        ctx.fill(); ctx.strokeStyle = 'white'; ctx.lineWidth = 1; ctx.stroke();
      });

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 1;
      const vpW = canvas.width * minimapScale; const vpH = canvas.height * minimapScale;
      ctx.strokeRect(mmX + viewportXLeft * minimapScale, mmY + viewportYTop * minimapScale, vpW, vpH);
      
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      ctx.strokeRect(mmX, mmY, minimapSize, minimapSize);

      renderRafId = requestAnimationFrame(render);
    };

    renderRafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(renderRafId);
  }, [isMobile]);

  const handleTouch = (e) => {
    if (!isMobile || user.isAdmin) return;
    if (e.cancelable) e.preventDefault(); 
    if (e.type === 'touchend' || e.touches.length === 0) {
      keysRef.current.w = keysRef.current.s = keysRef.current.a = keysRef.current.d = false;
      return;
    }
    const touch = e.touches[0];
    const rect = canvasRef.current.getBoundingClientRect();
    const x = touch.clientX - rect.left; const y = touch.clientY - rect.top;
    const dx = x - rect.width / 2; const dy = y - rect.height / 2;
    keysRef.current.w = keysRef.current.s = keysRef.current.a = keysRef.current.d = false;

    if (Math.abs(dx) > Math.abs(dy)) {
      if (dx > 0) keysRef.current.d = true; else keysRef.current.a = true;
    } else {
      if (dy > 0) keysRef.current.s = true; else keysRef.current.w = true;
    }
  };

  return (
    <div ref={containerRef} style={{ flex: 1, backgroundColor: '#000', overflow: 'hidden', position: 'relative' }}>
      <canvas ref={canvasRef} style={{ display: 'block', outline: 'none', touchAction: 'none' }} tabIndex={0}
        onTouchStart={handleTouch} onTouchMove={handleTouch} onTouchEnd={handleTouch} onTouchCancel={handleTouch} />
      <div className="panel" style={{ position: 'absolute', top: isMobile ? 8 : 16, right: isMobile ? 8 : 16, width: isMobile ? 140 : 200, pointerEvents: 'none', background: 'rgba(15, 23, 42, 0.7)', backdropFilter: 'blur(10px)' }}>
        <div className="panel-header" style={{ padding: isMobile ? '6px 10px' : '10px 16px', fontSize: isMobile ? '0.75rem' : '0.85rem' }}>
          <span>실시간 순위 🏆</span>
        </div>
        <div style={{ padding: isMobile ? 8 : 12, display: 'flex', flexDirection: 'column', gap: isMobile ? 6 : 8 }}>
          {leaderboard.length === 0 ? <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>데이터 없음</p> : 
            leaderboard.map((u, idx) => (
              <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '70%' }}>
                  <span style={{ fontSize: isMobile ? '0.7rem' : '0.8rem', opacity: 0.7, fontWeight: 'bold' }}>{idx + 1}</span>
                  <div style={{ minWidth: isMobile ? 6 : 8, height: isMobile ? 6 : 8, background: u.color, borderRadius: 2 }}></div>
                  <span style={{ fontSize: isMobile ? '0.75rem' : '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.nickname}</span>
                </div>
                <span style={{ fontSize: isMobile ? '0.75rem' : '0.85rem', fontWeight: 'bold' }}>{u.count}</span>
              </div>
            ))
          }
        </div>
      </div>
      {!user.isAdmin && (
        <div style={{ position: 'absolute', bottom: isMobile ? 12 : 24, right: isMobile ? 12 : 24, pointerEvents: 'none', textAlign: 'right' }}>
          <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: 2 }}>
            {isMobile ? 'Touch screen to move' : 'Arrow Keys or WASD to Move'}
          </p>
        </div>
      )}
    </div>
  );
};

export default memo(GameCanvas);
