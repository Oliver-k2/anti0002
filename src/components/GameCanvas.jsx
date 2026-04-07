import React, { useRef, useEffect, useState, memo } from 'react';
import { ref, onChildAdded, onChildChanged, onChildRemoved, onDisconnect, set, update, remove, get } from 'firebase/database';
import { db } from '../firebase';
import { throttle } from 'lodash';

// 맵 상수를 확장
const TILE_SIZE = 10;
const WORLD_WIDTH = 2000;
const WORLD_HEIGHT = 2000;

const GameCanvas = ({ user }) => {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [leaderboard, setLeaderboard] = useState([]);
  
  // 상태를 Refs에 저장하여 Canvas 렌더링 루프(RAF)에서 항상 최신 값을 참조
  const playersRef = useRef(new Map());
  const tilesRef = useRef(new Map()); 
  
  // 내 위치 관리 (관리자면 중앙 고정, 일반 유저면 랜덤 배치)
  const myPos = useRef({ 
    x: user.isAdmin ? WORLD_WIDTH / 2 : Math.floor((Math.random() * WORLD_WIDTH)/TILE_SIZE) * TILE_SIZE, 
    y: user.isAdmin ? WORLD_HEIGHT / 2 : Math.floor((Math.random() * WORLD_HEIGHT)/TILE_SIZE) * TILE_SIZE 
  });

  // 네트워크 동기화 Throttling (100ms)
  const syncPositionToFirebase = useRef(
    throttle((pos) => {
      update(ref(db, `players/${user.uid}`), { x: pos.x, y: pos.y });
    }, 100)
  ).current;

  // 타일(땅) 색칠하기
  const paintTile = (x, y) => {
    if (user.isAdmin) return; // 관리자는 타일을 칠하지 않음
    
    const tileKey = `${x}_${y}`;
    const newTile = { uid: user.uid, color: user.color, nickname: user.nickname };
    
    // 로컬 즉시 반영 (반응성 강화)
    tilesRef.current.set(tileKey, newTile);
    
    // 파이어베이스 갱신
    update(ref(db, 'tiles'), { [tileKey]: newTile }).catch(console.error);
  };

  // 창고 리사이징 로직
  useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current && containerRef.current) {
        canvasRef.current.width = containerRef.current.clientWidth;
        canvasRef.current.height = containerRef.current.clientHeight;
      }
    };
    window.addEventListener('resize', handleResize);
    setTimeout(handleResize, 50); // 초기 렌더 후 크기 적용
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    // 1. 플레이어 초기 설정 및 onDisconnect 처리 (관리자가 아닐 때만)
    let myPlayerRef = null;
    if (!user.isAdmin) {
      myPlayerRef = ref(db, `players/${user.uid}`);
      set(myPlayerRef, {
        uid: user.uid,
        nickname: user.nickname,
        color: user.color,
        x: myPos.current.x,
        y: myPos.current.y
      });
      onDisconnect(myPlayerRef).remove(); // 브라우저 종료 및 탭 닫기 시 삭제
    }

    // 2. 다른 플레이어 실시간 수신 리스너 (onChild*를 사용하여 과부하 방지)
    const handlePlayerAdded = (snap) => playersRef.current.set(snap.key, snap.val());
    const handlePlayerChanged = (snap) => playersRef.current.set(snap.key, snap.val());
    const handlePlayerRemoved = (snap) => playersRef.current.delete(snap.key);
    
    const playersDbRef = ref(db, 'players');
    onChildAdded(playersDbRef, handlePlayerAdded);
    onChildChanged(playersDbRef, handlePlayerChanged);
    onChildRemoved(playersDbRef, handlePlayerRemoved);

    // 3. 타일(땅) 실시간 수신 리스너
    const handleTileAdded = (snap) => tilesRef.current.set(snap.key, snap.val());
    const handleTileChanged = (snap) => tilesRef.current.set(snap.key, snap.val());
    const handleTileRemoved = (snap) => tilesRef.current.delete(snap.key);
    
    // 타일 초기 1회 로딩
    const tilesDbRef = ref(db, 'tiles');
    get(tilesDbRef).then(snapshot => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        Object.keys(data).forEach(k => tilesRef.current.set(k, data[k]));
      }
      onChildAdded(tilesDbRef, handleTileAdded);
      onChildChanged(tilesDbRef, handleTileChanged);
      onChildRemoved(tilesDbRef, handleTileRemoved); // 리셋 대비 제거 이벤트도 구독
    });

    if (!user.isAdmin) {
      paintTile(myPos.current.x, myPos.current.y); // 최초 접속 위치 점령
    }

    // Cleanup
    return () => {
      if (myPlayerRef) remove(myPlayerRef);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.uid, user.isAdmin]);

  // 키보드 이벤트 처리
  useEffect(() => {
    const keys = {};
    const handleKeyDown = (e) => { 
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
      }
      keys[e.key] = true; 
    };
    const handleKeyUp = (e) => { keys[e.key] = false; };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // 이동 로직 루프
    let moveRaf;
    const moveLoop = () => {
      let moved = false;
      const speed = user.isAdmin ? TILE_SIZE * 3 : TILE_SIZE; // 관리자(관전모드)는 더 빠르게 카메라 이동
      
      const newPos = { ...myPos.current };
      
      if ((keys['w'] || keys['ArrowUp']) && newPos.y > 0) { newPos.y -= speed; moved = true; }
      else if ((keys['s'] || keys['ArrowDown']) && newPos.y < WORLD_HEIGHT - TILE_SIZE) { newPos.y += speed; moved = true; }
      else if ((keys['a'] || keys['ArrowLeft']) && newPos.x > 0) { newPos.x -= speed; moved = true; }
      else if ((keys['d'] || keys['ArrowRight']) && newPos.x < WORLD_WIDTH - TILE_SIZE) { newPos.x += speed; moved = true; }

      if (moved) {
        myPos.current = newPos;
        
        if (!user.isAdmin) {
          // 키 입력에 대한 연속 이동 제한 (한 누름당 한 칸)
          keys['w'] = keys['s'] = keys['a'] = keys['d'] = false;
          keys['ArrowUp'] = keys['ArrowDown'] = keys['ArrowLeft'] = keys['ArrowRight'] = false;
          
          paintTile(newPos.x, newPos.y);
          syncPositionToFirebase(newPos);
        }
      }

      moveRaf = setTimeout(moveLoop, 50); // 50ms마다 움직임 체크
    };
    moveLoop();

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      clearTimeout(moveRaf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.isAdmin]);

  // 렌더링 및 리더보드 계산 루프
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let renderRafId;

    const render = () => {
      // 1. 전체 초기화
      ctx.setTransform(1, 0, 0, 1, 0, 0); // 화면 전체 지우기 위해 트랜스폼 초기화
      ctx.fillStyle = '#0f172a'; // 메인 배경
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // 2. 카메라 시점 적용
      const cameraX = Math.floor(canvas.width / 2) - myPos.current.x;
      const cameraY = Math.floor(canvas.height / 2) - myPos.current.y;
      ctx.translate(cameraX, cameraY);

      // 3. 월드 경계선
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 2;
      ctx.strokeRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

      // 4. 타일(땅) 렌더링
      const scoreMap = new Map();
      
      // 현재 뷰포트 영역 계산 (화면에 보이는 영역 + 여유 공간)
      const viewportXLeft = myPos.current.x - canvas.width / 2;
      const viewportXRight = myPos.current.x + canvas.width / 2;
      const viewportYTop = myPos.current.y - canvas.height / 2;
      const viewportYBottom = myPos.current.y + canvas.height / 2;

      tilesRef.current.forEach((tile, key) => {
        const [strX, strY] = key.split('_');
        const x = parseInt(strX, 10);
        const y = parseInt(strY, 10);

        // 화면 밖은 렌더링 생략 (성능 최적화)
        if (x + TILE_SIZE >= viewportXLeft && x <= viewportXRight && y + TILE_SIZE >= viewportYTop && y <= viewportYBottom) {
          ctx.fillStyle = tile.color;
          ctx.fillRect(x, y, TILE_SIZE - 1, TILE_SIZE - 1); 
        }

        // 점수 집계 (전체 집계)
        if (!scoreMap.has(tile.uid)) {
          scoreMap.set(tile.uid, { nickname: tile.nickname, count: 0, color: tile.color });
        }
        scoreMap.get(tile.uid).count += 1;
      });

      // 리더보드 갱신
      const sortedLeaderboard = Array.from(scoreMap.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, 5); // Top 5
      setLeaderboard(sortedLeaderboard);

      // 5. 플레이어 렌더링
      playersRef.current.forEach((player) => {
        if (player.x + TILE_SIZE < viewportXLeft || player.x > viewportXRight || player.y + TILE_SIZE < viewportYTop || player.y > viewportYBottom) return;

        // 테두리
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(player.x - 1, player.y - 1, TILE_SIZE + 2, TILE_SIZE + 2);
        
        ctx.fillStyle = player.color;
        ctx.fillRect(player.x, player.y, TILE_SIZE, TILE_SIZE);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.font = '10px Inter';
        ctx.textAlign = 'center';

        const textWidth = ctx.measureText(player.nickname).width;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(player.x + TILE_SIZE / 2 - textWidth / 2 - 2, player.y - 15, textWidth + 4, 12);

        ctx.fillStyle = 'white';
        ctx.fillText(player.nickname, player.x + TILE_SIZE / 2, player.y - 5);
      });

      // 6. 미니맵 렌더링 (화면 좌측 하단, 카메라 고정)
      ctx.setTransform(1, 0, 0, 1, 0, 0); // 오프셋 제거
      
      const minimapSize = 150;
      const minimapScale = minimapSize / WORLD_WIDTH;
      const padding = 20;
      const mmX = padding;
      const mmY = canvas.height - minimapSize - padding;

      // 미니맵 배경
      ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
      ctx.fillRect(mmX, mmY, minimapSize, minimapSize);
      ctx.strokeStyle = 'var(--border-color)';
      ctx.strokeRect(mmX, mmY, minimapSize, minimapSize);

      // 미니맵 타일 렌더링 (점)
      tilesRef.current.forEach((tile, key) => {
        const [strX, strY] = key.split('_');
        const x = parseInt(strX, 10);
        const y = parseInt(strY, 10);
        ctx.fillStyle = tile.color;
        
        // 1px 점 표시 (만약 맵이 커질 시 크기 조절 필요)
        ctx.fillRect(mmX + x * minimapScale, mmY + y * minimapScale, Math.max(1, TILE_SIZE * minimapScale), Math.max(1, TILE_SIZE * minimapScale));
      });

      // 미니맵 플레이어 및 내 위치 렌더링
      playersRef.current.forEach((player) => {
        ctx.fillStyle = player.color;
        ctx.beginPath();
        ctx.arc(mmX + player.x * minimapScale, mmY + player.y * minimapScale, 2, 0, Math.PI * 2);
        ctx.fill();
      });

      // 현재 시점 뷰포트 (흰색 테두리 사각형) 표시
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.lineWidth = 1;
      const vpW = canvas.width * minimapScale;
      const vpH = canvas.height * minimapScale;
      ctx.strokeRect(mmX + viewportXLeft * minimapScale, mmY + viewportYTop * minimapScale, vpW, vpH);

      renderRafId = requestAnimationFrame(render);
    };

    renderRafId = requestAnimationFrame(render);

    return () => cancelAnimationFrame(renderRafId);
  }, []);

  return (
    <div className="panel" style={{ gridArea: 'game', position: 'relative', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header" style={{ position: 'absolute', top: 0, left: 0, right: 0, background: 'rgba(30, 41, 59, 0.8)', backdropFilter: 'blur(4px)', zIndex: 10, borderBottom: 'none' }}>
        <span>{user.isAdmin ? '픽셀 땅따먹기 전장 관전 👁️' : '픽셀 땅따먹기 전장'}</span>
      </div>
      
      {/* 리더보드 UI */}
      <div style={{ position: 'absolute', top: 60, right: 16, background: 'rgba(15, 23, 42, 0.8)', padding: 12, borderRadius: 8, border: '1px solid var(--border-color)', zIndex: 10, backdropFilter: 'blur(4px)', minWidth: 150 }}>
        <h3 style={{ fontSize: '0.9rem', marginBottom: 8, color: 'var(--text-muted)' }}>실시간 리더보드 (Top 5)</h3>
        {leaderboard.length === 0 && <div style={{ fontSize: '0.8rem' }}>데이터 없음</div>}
        {leaderboard.map((u, idx) => (
          <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <strong style={{ fontSize: '0.9rem' }}>{idx + 1}.</strong>
              <div style={{ width: 10, height: 10, backgroundColor: u.color, borderRadius: 2 }}></div>
              <span style={{ fontSize: '0.85rem', width: 60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.nickname}</span>
            </div>
            <strong style={{ fontSize: '0.85rem' }}>{u.count}</strong>
          </div>
        ))}
      </div>

      {/* 캔버스 컨테이너: flex 1로 가득 채우고 동적 리사이징 확보 */}
      <div ref={containerRef} style={{ flex: 1, backgroundColor: 'var(--bg-color)', overflow: 'hidden', position: 'relative' }}>
        <canvas 
          ref={canvasRef} 
          style={{ backgroundColor: '#0f172a', display: 'block', outline: 'none' }}
          tabIndex={0}
        />
      </div>
    </div>
  );
};

export default memo(GameCanvas);
