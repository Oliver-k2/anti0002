import React, { useState, useEffect } from 'react';
import { ref, onValue, set, update, remove, get } from 'firebase/database';
import { db } from './firebase';
import GameCanvas from './components/GameCanvas';
import Chat from './components/Chat';
import './index.css';

function App() {
  const [user, setUser] = useState(null); // { uid, nickname, color, status }
  const [inputName, setInputName] = useState('');
  const [adminMode, setAdminMode] = useState(false);
  const [pendingUsers, setPendingUsers] = useState([]);
  const [resetTime, setResetTime] = useState(null);
  const [timeLeft, setTimeLeft] = useState('00:00:00');
  
  const [adminPassword, setAdminPassword] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [isPasswordSet, setIsPasswordSet] = useState(false);
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [newPassword, setNewPassword] = useState('');

  useEffect(() => {
    const configRef = ref(db, 'config/resetTimer');
    const unsubscribe = onValue(configRef, (snapshot) => {
      if (snapshot.exists()) {
        setResetTime(snapshot.val());
      } else {
        const nextTime = Date.now() + 24 * 60 * 60 * 1000;
        set(ref(db, 'config/resetTimer'), nextTime);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!resetTime) return;
    const timer = setInterval(() => {
      const now = Date.now();
      const diff = resetTime - now;
      if (diff <= 0) {
        setTimeLeft('00:00:00');
        if (Math.abs(diff) < 5000) { 
          handleResetData();
        }
      } else {
        const h = Math.floor((diff / (1000 * 60 * 60)) % 24).toString().padStart(2, '0');
        const m = Math.floor((diff / 1000 / 60) % 60).toString().padStart(2, '0');
        const s = Math.floor((diff / 1000) % 60).toString().padStart(2, '0');
        setTimeLeft(`${h}:${m}:${s}`);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [resetTime]);

  const handleResetData = () => {
    const nextTime = Date.now() + 24 * 60 * 60 * 1000;
    const updates = {};
    updates['config/resetTimer'] = nextTime;
    updates['chat'] = null;
    updates['players'] = null;
    updates['tiles'] = null;
    update(ref(db), updates).catch(console.error);
    alert('맵과 채팅 데이터가 리셋되었습니다!');
  };

  useEffect(() => {
    const adminRef = ref(db, 'admin_config');
    onValue(adminRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        if (data.password) {
          setAdminPassword(data.password);
          setIsPasswordSet(true);
        } else {
          setIsPasswordSet(false);
        }
      } else {
        setIsPasswordSet(false);
      }
    });

    if (adminMode) {
      const approvalsRef = ref(db, 'approvals');
      const unsubscribe = onValue(approvalsRef, (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.val();
          const pending = Object.values(data).filter(u => u.status === 'pending');
          setPendingUsers(pending);
        } else {
          setPendingUsers([]);
        }
      });
      return () => unsubscribe();
    }
  }, [adminMode]);

  useEffect(() => {
    if (user && user.status === 'pending') {
      const userRef = ref(db, `approvals/${user.uid}`);
      const unsubscribe = onValue(userRef, (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.val();
          if (data.status === 'approved') {
            setUser(prev => ({ ...prev, status: 'approved' }));
          }
        } else {
          setUser(null);
          alert("접속이 거절되었습니다.");
        }
      });
      return () => unsubscribe();
    }
  }, [user]);

  const handleLogin = (e) => {
    e.preventDefault();
    const name = inputName.trim();
    if (!name) return;

    if (name === '관리자') {
      if (isPasswordSet) {
        setShowPasswordPrompt(true);
      } else {
        setAdminMode(true);
      }
      return;
    }

    const randomColor = `hsl(${Math.floor(Math.random() * 360)}, 70%, 50%)`;
    const uid = 'uid_' + Math.random().toString(36).substr(2, 9);
    const newUser = { uid, nickname: name, color: randomColor, status: 'pending' };
    
    set(ref(db, `approvals/${uid}`), newUser)
      .then(() => {
        setUser(newUser);
      })
      .catch(err => console.error(err));
  };

  const handlePasswordSubmit = (e) => {
    e.preventDefault();
    if (passwordInput === adminPassword) {
      setAdminMode(true);
      setShowPasswordPrompt(false);
      setPasswordInput('');
    } else {
      alert('비밀번호가 틀렸습니다.');
    }
  };

  const updateAdminPassword = () => {
    if (!newPassword.trim()) {
      alert('비밀번호를 입력하세요.');
      return;
    }
    update(ref(db, 'admin_config'), { password: newPassword.trim() })
      .then(() => {
        alert('관리자 비밀번호가 설정/변경되었습니다.');
        setNewPassword('');
      })
      .catch(console.error);
  };

  const approveUser = (uid) => {
    update(ref(db, `approvals/${uid}`), { status: 'approved' });
  };
  
  const rejectUser = (uid) => {
    remove(ref(db, `approvals/${uid}`));
  };

  const adminUser = { uid: 'admin_uid', nickname: '관리자', isAdmin: true, status: 'approved', color: '#ff0000' };

  // 관리자 모드 UI
  if (adminMode) {
    return (
      <div id="root">
        <header className="app-header">
          <div className="app-title">
            <span>🛠️ 관리자 제어판</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>리셋까지 남은 시간</span>
              <strong style={{ fontSize: '1.1rem', letterSpacing: 1 }}>{timeLeft}</strong>
            </div>
            <button onClick={handleResetData} className="danger">즉시 리셋 💣</button>
            <button onClick={() => { setAdminMode(false); setInputName(''); }} className="secondary">로그아웃</button>
          </div>
        </header>

        <div className="main-container">
          <div className="game-area">
            <GameCanvas user={adminUser} />
          </div>
          
          <aside className="sidebar">
            <div className="panel" style={{ flex: 'none' }}>
              <div className="panel-header">
                <span>비밀번호 관리</span>
              </div>
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <input 
                  type="password" 
                  placeholder="새 비밀번호" 
                  value={newPassword} 
                  onChange={e => setNewPassword(e.target.value)}
                />
                <button onClick={updateAdminPassword}>설정 저장</button>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {isPasswordSet ? '✅ 현재 비밀번호가 설정되어 있습니다.' : '⚠️ 비밀번호가 설정되지 않았습니다.'}
                </p>
              </div>
            </div>

            <div className="panel" style={{ flex: 1 }}>
              <div className="panel-header">
                <span>접속 승인 대기 ({pendingUsers.length})</span>
              </div>
              <div style={{ padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {pendingUsers.length === 0 ? (
                  <p style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: 20 }}>대기중인 유저가 없습니다.</p>
                ) : (
                  pendingUsers.map(u => (
                    <div key={u.uid} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.05)', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border-color)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 12, height: 12, background: u.color, borderRadius: '50%', boxShadow: `0 0 8px ${u.color}` }}></div>
                        <span style={{ fontWeight: '600', fontSize: '0.9rem' }}>{u.nickname}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => approveUser(u.uid)} style={{ padding: '6px 12px', fontSize: '0.8rem' }}>승인</button>
                        <button onClick={() => rejectUser(u.uid)} className="danger" style={{ padding: '6px 12px', fontSize: '0.8rem' }}>거절</button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>
    );
  }

  // 관리자 비밀번호 입력 폼
  if (showPasswordPrompt) {
    return (
      <div style={{ display: 'flex', height: '100vh', justifyContent: 'center', alignItems: 'center', background: 'var(--bg-color)' }}>
        <form onSubmit={handlePasswordSubmit} className="panel" style={{ padding: 32, width: 340, gap: 24 }}>
          <h2 style={{ textAlign: 'center', fontWeight: 800 }}>관리자 인증</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input 
              type="password" 
              placeholder="비밀번호 입력" 
              value={passwordInput} 
              onChange={e => setPasswordInput(e.target.value)} 
              autoFocus 
            />
            <button type="submit" style={{ width: '100%' }}>입장하기</button>
            <button type="button" onClick={() => setShowPasswordPrompt(false)} className="secondary" style={{ width: '100%' }}>취소</button>
          </div>
        </form>
      </div>
    );
  }

  // 일반 로그인 폼
  if (!user) {
    return (
      <div style={{ display: 'flex', height: '100vh', justifyContent: 'center', alignItems: 'center', background: 'var(--bg-color)' }}>
        <form onSubmit={handleLogin} className="panel" style={{ padding: 40, width: 360, gap: 24 }}>
          <div style={{ textAlign: 'center' }}>
            <h1 style={{ fontSize: '2rem', marginBottom: 8, background: 'linear-gradient(to right, #60a5fa, #a78bfa)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>PIXEL WARS</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>픽셀로 영토를 확장하세요!</p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input 
              type="text" 
              placeholder="닉네임 입력" 
              value={inputName} 
              onChange={e => setInputName(e.target.value)} 
              autoFocus 
            />
            <button type="submit" style={{ width: '100%', padding: 14, fontSize: '1rem' }}>접속 요청하기</button>
          </div>
          <p style={{ textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-muted)' }}>관리자 승인 후 입장이 가능합니다.</p>
        </form>
      </div>
    );
  }

  // 대기 화면
  if (user.status === 'pending') {
    return (
      <div style={{ display: 'flex', height: '100vh', justifyContent: 'center', alignItems: 'center', background: 'var(--bg-color)' }}>
        <div className="panel" style={{ padding: 48, textAlign: 'center', width: 400, gap: 20 }}>
          <div className="loading-spinner" style={{ width: 40, height: 40, border: '4px solid rgba(255,255,255,0.1)', borderTopColor: 'var(--accent)', borderRadius: '50%', margin: '0 auto', animation: 'spin 1s linear infinite' }}></div>
          <h2>승인 대기 중...</h2>
          <p style={{ color: 'var(--text-muted)' }}>관리자가 확인 중입니다. 잠시만 기다려주세요.</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  // 정규 게임 플레이 화면
  return (
    <div id="root">
      <header className="app-header">
        <div className="app-title">
          <div style={{ width: 24, height: 24, background: user.color, borderRadius: 4, boxShadow: `0 0 12px ${user.color}` }}></div>
          <span>PIXEL WARS</span>
        </div>
        
        <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(255,255,255,0.05)', padding: '6px 16px', borderRadius: 20, border: '1px solid var(--border-color)' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>리셋까지</span>
          <strong style={{ fontSize: '1rem', color: 'white', fontFamily: 'monospace' }}>{timeLeft}</strong>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>접속 중: <strong>{user.nickname}</strong></span>
          <button onClick={() => window.location.reload()} className="secondary" style={{ padding: '6px 12px', fontSize: '0.8rem' }}>로그아웃</button>
        </div>
      </header>

      <div className="main-container">
        <div className="game-area">
          <GameCanvas user={user} />
        </div>
        
        <aside className="sidebar">
          <Chat user={user} />
        </aside>
      </div>
    </div>
  );
}

export default App;
