function App() {
  const [memories, setMemories] = React.useState([
    { id: 1, name: "First day of school", weight: 85, opacity: 0.3, cost: 15, angle: 0, distance: 200 },
    { id: 2, name: "Mother's lullaby", weight: 95, opacity: 0.15, cost: 35, angle: 45, distance: 250 },
    { id: 3, name: "Summer by the lake", weight: 70, opacity: 0.45, cost: 8, angle: 90, distance: 180 },
    { id: 4, name: "Grandfather's stories", weight: 80, opacity: 0.25, cost: 20, angle: 135, distance: 220 },
    { id: 5, name: "Best friend's laugh", weight: 75, opacity: 0.4, cost: 12, angle: 180, distance: 190 },
    { id: 6, name: "First heartbreak", weight: 90, opacity: 0.2, cost: 30, angle: 225, distance: 240 },
    { id: 7, name: "Childhood bedroom", weight: 65, opacity: 0.5, cost: 5, angle: 270, distance: 170 },
    { id: 8, name: "Family dinner table", weight: 88, opacity: 0.22, cost: 25, angle: 315, distance: 230 }
  ]);
  
  const [heartMeter, setHeartMeter] = React.useState(100);
  const [selectedMemory, setSelectedMemory] = React.useState(null);
  const [particles, setParticles] = React.useState([]);
  const [draggedParticles, setDraggedParticles] = React.useState(0);
  const [isDragging, setIsDragging] = React.useState(false);
  const [reclaimed, setReclaimed] = React.useState([]);

  const handleMemoryClick = (memory) => {
    if (reclaimed.includes(memory.id)) return;
    setSelectedMemory(memory.id === selectedMemory ? null : memory.id);
    setDraggedParticles(0);
  };

  const handleDragStart = (e) => {
    if (heartMeter <= 0) return;
    setIsDragging(true);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setIsDragging(false);
  };

  const handleDrop = (e, memory) => {
    e.preventDefault();
    if (isDragging && selectedMemory === memory.id && heartMeter >= memory.cost) {
      // Reclaim memory
      setHeartMeter(prev => prev - memory.cost);
      setReclaimed(prev => [...prev, memory.id]);
      
      // Make other memories drift away and more expensive
      setMemories(prev => prev.map(m => {
        if (m.id === memory.id) return m;
        return {
          ...m,
          distance: m.distance + 50,
          cost: Math.min(50, m.cost + 5),
          opacity: Math.max(0.1, m.opacity - 0.05)
        };
      }));

      // Create particle effect
      const newParticles = Array(memory.cost).fill(null).map((_, i) => ({
        id: Date.now() + i,
        x: e.clientX - 5 + (Math.random() - 0.5) * 20,
        y: e.clientY - 5 + (Math.random() - 0.5) * 20
      }));
      setParticles(prev => [...prev, ...newParticles]);
      
      setTimeout(() => {
        setParticles(prev => prev.filter(p => !newParticles.find(np => np.id === p.id)));
      }, 1000);

      setSelectedMemory(null);
    }
    setIsDragging(false);
  };

  const Memory = ({ memory }) => {
    const isSelected = selectedMemory === memory.id;
    const isReclaimed = reclaimed.includes(memory.id);
    const canAfford = heartMeter >= memory.cost;
    
    const radians = (memory.angle * Math.PI) / 180;
    const x = Math.cos(radians) * memory.distance;
    const z = Math.sin(radians) * memory.distance;

    return React.createElement('div', {
      style: {
        position: 'absolute',
        left: '50%',
        top: '50%',
        transform: `translate3d(${x}px, 0, ${z}px) translate(-50%, -50%)`,
        transformStyle: 'preserve-3d',
        cursor: isReclaimed ? 'default' : 'pointer',
        opacity: isReclaimed ? 1 : 1
      },
      onClick: () => handleMemoryClick(memory),
      onDrop: (e) => handleDrop(e, memory),
      onDragOver: (e) => e.preventDefault()
    }, [
      React.createElement('div', {
        key: 'orb',
        style: {
          width: memory.weight + 'px',
          height: memory.weight + 'px',
          borderRadius: '50%',
          background: isReclaimed 
            ? `radial-gradient(circle at 30% 30%, rgba(255,255,255,0.8), rgba(200,200,255,0.4))`
            : `radial-gradient(circle at 30% 30%, rgba(255,255,255,${memory.opacity}), rgba(150,150,200,${memory.opacity * 0.5}))`,
          border: isSelected && !isReclaimed ? '2px solid rgba(255,255,255,0.4)' : 'none',
          boxShadow: isReclaimed 
            ? '0 0 40px rgba(150,150,255,0.6), inset 0 0 20px rgba(255,255,255,0.3)'
            : `0 0 20px rgba(150,150,255,${memory.opacity}), inset 0 0 15px rgba(255,255,255,${memory.opacity * 0.3})`,
          animation: !isReclaimed ? 'drift 20s ease-in-out infinite' : 'none',
          animationDelay: memory.id + 's',
          transition: 'all 0.6s ease',
          backdropFilter: 'blur(5px)'
        }
      }),
      (isSelected && !isReclaimed) && React.createElement('div', {
        key: 'info',
        style: {
          position: 'absolute',
          top: '-60px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.8)',
          padding: '8px 16px',
          borderRadius: '4px',
          whiteSpace: 'nowrap',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          fontSize: '14px',
          color: '#fff'
        }
      }, [
        React.createElement('div', { key: 'name' }, memory.name),
        React.createElement('div', { 
          key: 'cost',
          style: { 
            fontSize: '12px', 
            color: canAfford ? 'rgba(255,200,150,0.8)' : 'rgba(255,100,100,0.8)',
            marginTop: '4px' 
          } 
        }, `Cost: ${memory.cost} emotions`)
      ])
    ]);
  };

  return React.createElement('div', {
    style: {
      width: '100vw',
      height: '100vh',
      background: 'radial-gradient(ellipse at center, #0a0a0f 0%, #000 100%)',
      overflow: 'hidden',
      position: 'relative',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      perspective: '1200px'
    }
  }, [
    // Title
    React.createElement('div', {
      key: 'title',
      style: {
        position: 'absolute',
        top: '40px',
        left: '50%',
        transform: 'translateX(-50%)',
        textAlign: 'center',
        color: 'rgba(255,255,255,0.7)',
        zIndex: 10
      }
    }, [
      React.createElement('h1', {
        key: 'h1',
        style: {
          margin: 0,
          fontSize: '32px',
          fontWeight: '200',
          letterSpacing: '0.15em',
          marginBottom: '8px'
        }
      }, 'MEMORY AUCTION HOUSE'),
      React.createElement('p', {
        key: 'p',
        style: {
          margin: 0,
          fontSize: '14px',
          color: 'rgba(255,255,255,0.4)',
          letterSpacing: '0.05em'
        }
      }, 'Trade emotions for forgotten moments')
    ]),

    // Heart Meter
    React.createElement('div', {
      key: 'heart',
      style: {
        position: 'absolute',
        bottom: '60px',
        left: '50%',
        transform: 'translateX(-50%)',
        width: '200px',
        zIndex: 10
      }
    }, [
      React.createElement('div', {
        key: 'label',
        style: {
          textAlign: 'center',
          color: 'rgba(255,255,255,0.5)',
          fontSize: '12px',
          marginBottom: '8px',
          letterSpacing: '0.1em'
        }
      }, 'EMOTIONAL RESERVES'),
      React.createElement('div', {
        key: 'meter',
        style: {
          width: '200px',
          height: '40px',
          background: 'rgba(255,255,255,0.1)',
          borderRadius: '20px',
          position: 'relative',
          overflow: 'hidden'
        }
      }, [
        React.createElement('div', {
          key: 'fill',
          style: {
            position: 'absolute',
            left: 0,
            top: 0,
            height: '100%',
            width: heartMeter + '%',
            background: 'linear-gradient(90deg, rgba(255,100,150,0.8), rgba(255,200,150,0.8))',
            boxShadow: '0 0 20px rgba(255,150,150,0.4)',
            transition: 'width 0.6s ease',
            borderRadius: '20px'
          }
        }),
        React.createElement('div', {
          key: 'particles',
          draggable: heartMeter > 0 && selectedMemory,
          onDragStart: handleDragStart,
          onDragEnd: handleDragEnd,
          style: {
            position: 'absolute',
            inset: 0,
            cursor: heartMeter > 0 && selectedMemory ? 'grab' : 'default',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }
        }, isDragging ? '✨' : '')
      ]),
      React.createElement('div', {
        key: 'value',
        style: {
          textAlign: 'center',
          marginTop: '8px',
          color: 'rgba(255,255,255,0.6)',
          fontSize: '18px',
          fontWeight: '300'
        }
      }, heartMeter)
    ]),

    // Memory Carousel
    React.createElement('div', {
      key: 'carousel',
      style: {
        position: 'absolute',
        inset: 0,
        transformStyle: 'preserve-3d',
        animation: 'carouselSpin 60s linear infinite'
      }
    }, memories.map(memory => 
      React.createElement(Memory, { key: memory.id, memory })
    )),

    // Particles
    ...particles.map(particle => 
      React.createElement('div', {
        key: particle.id,
        style: {
          position: 'absolute',
          left: particle.x + 'px',
          top: particle.y + 'px',
          width: '10px',
          height: '10px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(255,200,150,0.8), rgba(255,100,150,0.4))',
          boxShadow: '0 0 10px rgba(255,150,150,0.6)',
          animation: 'particleFloat 1s ease-out forwards',
          pointerEvents: 'none'
        }
      })
    ),

    // Instructions
    selectedMemory && React.createElement('div', {
      key: 'instructions',
      style: {
        position: 'absolute',
        bottom: '120px',
        left: '50%',
        transform: 'translateX(-50%)',
        color: 'rgba(255,255,255,0.4)',
        fontSize: '14px',
        textAlign: 'center',
        animation: 'pulse 2s ease-in-out infinite'
      }
    }, 'Drag emotions from your heart to the memory')
  ]);
}