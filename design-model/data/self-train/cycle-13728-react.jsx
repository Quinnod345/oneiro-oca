const styles = document.createElement('style');
styles.textContent = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
  
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }
  
  body {
    overflow: hidden;
    background: #0a0a0a;
    cursor: default;
  }
  
  @keyframes rot {
    0% { filter: hue-rotate(0deg) brightness(1); }
    25% { filter: hue-rotate(-20deg) brightness(0.9); }
    50% { filter: hue-rotate(-40deg) brightness(0.7); }
    75% { filter: hue-rotate(-60deg) brightness(0.5); }
    100% { filter: hue-rotate(-80deg) brightness(0.3) grayscale(0.8); }
  }
  
  @keyframes pulse {
    0%, 100% { opacity: 0.6; }
    50% { opacity: 1; }
  }
  
  @keyframes gravity {
    0% { transform: translateY(0); }
    100% { transform: translateY(20px); }
  }
`;
document.head.appendChild(styles);

function App() {
  const [tasks, setTasks] = React.useState([]);
  const [newTaskName, setNewTaskName] = React.useState('');
  const [draggedStone, setDraggedStone] = React.useState(null);
  const [interfaceWeight, setInterfaceWeight] = React.useState(0);
  const containerRef = React.useRef(null);

  React.useEffect(() => {
    const interval = setInterval(() => {
      setTasks(prev => prev.map(task => {
        if (task.completion === 0 && task.decay < 100) {
          return { ...task, decay: Math.min(100, task.decay + 1) };
        }
        return task;
      }));
    }, 200);
    return () => clearInterval(interval);
  }, []);

  React.useEffect(() => {
    const weight = tasks.filter(t => t.decay === 100).length * 0.1;
    setInterfaceWeight(weight);
  }, [tasks]);

  const addTask = () => {
    if (!newTaskName.trim()) return;
    setTasks([...tasks, {
      id: Date.now(),
      name: newTaskName,
      decay: 0,
      completion: 0,
      created: Date.now(),
      x: Math.random() * 60 + 20,
      y: Math.random() * 40 + 30
    }]);
    setNewTaskName('');
  };

  const updateCompletion = (id, delta) => {
    setTasks(tasks.map(task => 
      task.id === id 
        ? { ...task, completion: Math.max(0, Math.min(100, task.completion + delta)) }
        : task
    ));
  };

  const handleStoneDrag = (e, stone) => {
    if (e.type === 'dragstart') {
      setDraggedStone(stone);
      e.dataTransfer.effectAllowed = 'move';
    } else if (e.type === 'dragend') {
      setDraggedStone(null);
    }
  };

  const handleStoneDrop = (e) => {
    e.preventDefault();
    if (draggedStone && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      
      setTasks(tasks.map(task => 
        task.id === draggedStone.id 
          ? { ...task, x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) }
          : task
      ));
    }
  };

  const renderTask = (task) => {
    const isStone = task.decay === 100;
    const preservationLevel = task.completion / 100;
    const decayLevel = task.decay / 100;
    const effectiveDecay = decayLevel * (1 - preservationLevel);

    if (isStone) {
      return React.createElement('div', {
        key: task.id,
        draggable: true,
        onDragStart: (e) => handleStoneDrag(e, task),
        onDragEnd: (e) => handleStoneDrag(e, task),
        style: {
          position: 'absolute',
          left: `${task.x}%`,
          top: `${task.y}%`,
          transform: 'translate(-50%, -50%)',
          width: '120px',
          height: '120px',
          background: `radial-gradient(circle at 30% 30%, #2a2a2a, #0a0a0a)`,
          borderRadius: '30% 70% 70% 30% / 30% 30% 70% 70%',
          boxShadow: 'inset -10px -10px 20px rgba(0,0,0,0.8), 0 20px 40px rgba(0,0,0,0.8)',
          cursor: 'grab',
          transition: `transform ${0.3 + interfaceWeight}s ease-out`,
          animation: `gravity ${2 + interfaceWeight * 2}s ease-in-out infinite`,
          filter: 'contrast(1.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          padding: '20px',
          userSelect: 'none'
        }
      },
        React.createElement('div', {
          style: {
            color: '#444',
            fontSize: '11px',
            fontFamily: 'Inter, system-ui',
            fontWeight: '600',
            textAlign: 'center',
            letterSpacing: '0.5px',
            lineHeight: '1.4',
            textTransform: 'uppercase'
          }
        }, task.name),
        React.createElement('div', {
          style: {
            color: '#333',
            fontSize: '9px',
            fontFamily: 'Inter, system-ui',
            marginTop: '8px',
            opacity: 0.8
          }
        }, 'burden')
      );
    }

    const hue = 120 - (effectiveDecay * 120);
    const saturation = 70 - (effectiveDecay * 40);
    const lightness = 50 + (effectiveDecay * 10);

    return React.createElement('div', {
      key: task.id,
      style: {
        position: 'absolute',
        left: `${task.x}%`,
        top: `${task.y}%`,
        transform: 'translate(-50%, -50%)',
        transition: `all ${0.3 + interfaceWeight}s ease-out`
      }
    },
      React.createElement('div', {
        style: {
          position: 'relative',
          width: '160px',
          height: '160px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column'
        }
      },
        React.createElement('div', {
          style: {
            width: '100px',
            height: '100px',
            borderRadius: '50% 50% 50% 50% / 60% 60% 40% 40%',
            background: `radial-gradient(circle at 30% 30%, 
              hsl(${hue}, ${saturation}%, ${lightness + 20}%), 
              hsl(${hue}, ${saturation}%, ${lightness}%))`,
            boxShadow: `0 10px 30px rgba(0,0,0,0.4), inset 0 -5px 15px rgba(0,0,0,0.2)`,
            animation: effectiveDecay > 0 ? `rot ${5}s linear infinite` : 'none',
            animationDelay: `${effectiveDecay * 5}s`,
            filter: `brightness(${1 - effectiveDecay * 0.5})`,
            transition: 'all 0.5s ease',
            cursor: 'pointer',
            position: 'relative',
            overflow: 'hidden'
          },
          onClick: () => updateCompletion(task.id, 10)
        },
          preservationLevel > 0 && React.createElement('div', {
            style: {
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: `${preservationLevel * 100}%`,
              background: `linear-gradient(to top, 
                hsla(${120}, 70%, 60%, 0.6),
                hsla(${120}, 70%, 60%, 0.2))`,
              backdropFilter: 'blur(5px)',
              borderTop: '2px solid hsla(120, 70%, 70%, 0.8)',
              transition: 'height 0.3s ease'
            }
          }),
          Array.from({ length: Math.floor(effectiveDecay * 5) }).map((_, i) => 
            React.createElement('div', {
              key: i,
              style: {
                position: 'absolute',
                width: `${10 + Math.random() * 20}px`,
                height: `${10 + Math.random() * 20}px`,
                background: 'rgba(0,0,0,0.3)',
                borderRadius: '50%',
                left: `${Math.random() * 80}%`,
                top: `${Math.random() * 80}%`,
                filter: 'blur(2px)'
              }
            })
          )
        ),
        React.createElement('div', {
          style: {
            marginTop: '12px',
            textAlign: 'center'
          }
        },
          React.createElement('div', {
            style: {
              color: '#ddd',
              fontSize: '13px',
              fontFamily: 'Inter, system-ui',
              fontWeight: '500',
              marginBottom: '4px',
              letterSpacing: '0.3px'
            }
          }, task.name),
          React.createElement('div', {
            style: {
              color: '#888',
              fontSize: '11px',
              fontFamily: 'Inter, system-ui'
            }
          }, `${Math.floor(task.completion)}% preserved`)
        ),
        task.completion > 0 && task.completion < 100 && React.createElement('div', {
          style: {
            position: 'absolute',
            bottom: '-30px',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            gap: '8px'
          }
        },
          React.createElement('button', {
            onClick: () => updateCompletion(task.id, -10),
            style: {
              width: '24px',
              height: '24px',
              borderRadius: '50%',
              border: '1px solid #444',
              background: '#1a1a1a',
              color: '#666',
              fontSize: '16px',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }
          }, '-'),
          React.createElement('button', {
            onClick: () => updateCompletion(task.id, 10),
            style: {
              width: '24px',
              height: '24px',
              borderRadius: '50%',
              border: '1px solid #444',
              background: '#1a1a1a',
              color: '#666',
              fontSize: '16px',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }
          }, '+')
        )
      )
    );
  };

  return React.createElement('div', {
    ref: containerRef,
    onDragOver: (e) => e.preventDefault(),
    onDrop: handleStoneDrop,
    style: {
      width: '100vw',
      height: '100vh',
      background: 'linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 100%)',
      position: 'relative',
      overflow: 'hidden',
      fontFamily: 'Inter, system-ui',
      transition: `filter ${0.3 + interfaceWeight}s ease`,
      filter: `brightness(${1 - interfaceWeight * 0.3}) contrast(${1 - interfaceWeight * 0.2})`
    }
  },
    React.createElement('div', {
      style: {
        position: 'absolute',
        top: '40px',
        left: '50%',
        transform: 'translateX(-50%)',
        textAlign: 'center',
        color: '#666',
        fontSize: '14px',
        letterSpacing: '1px',
        fontWeight: '300',
        transition: `opacity ${0.3 + interfaceWeight}s ease`,
        opacity: 1 - interfaceWeight
      }
    }, 'NEGOTIATION WITH TOMORROW'),
    
    React.createElement('div', {
      style: {
        position: 'absolute',
        bottom: '40px',
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        gap: '12px',
        alignItems: 'center',
        background: 'rgba(0,0,0,0.8)',
        padding: '16px 24px',
        borderRadius: '30px',
        backdropFilter: 'blur(10px)',
        transition: `transform ${0.3 + interfaceWeight}s ease`,
      }
    },
      React.createElement('input', {
        type: 'text',
        value: newTaskName,
        onChange: (e) => setNewTaskName(e.target.value),
        onKeyPress: (e) => e.key === 'Enter' && addTask(),
        placeholder: 'What needs doing?',
        style: {
          background: 'transparent',
          border: 'none',
          outline: 'none',
          color: '#ddd',
          fontSize: '14px',
          fontFamily: 'Inter, system-ui',
          width: '200px',
          transition: `all ${0.3 + interfaceWeight}s ease`
        }
      }),
      React.createElement('button', {
        onClick: addTask,
        style: {
          background: '#333',
          border: 'none',
          color: '#888',
          padding: '8px 16px',
          borderRadius: '20px',
          fontSize: '13px',
          fontFamily: 'Inter, system-ui',
          cursor: 'pointer',
          transition: `all ${0.3 + interfaceWeight}s ease`,
          fontWeight: '500'
        }
      }, 'Plant')
    ),

    interfaceWeight > 0 && React.createElement('div', {
      style: {
        position: 'absolute',
        top: '40px',
        right: '40px',
        color: '#666',
        fontSize: '12px',
        fontFamily: 'Inter, system-ui',
        textAlign: 'right',
        animation: 'pulse 2s ease-in-out infinite'
      }
    },
      React.createElement('div', null, `Interface weight: ${Math.floor(interfaceWeight * 100)}%`),
      React.createElement('div', {
        style: { fontSize: '10px', marginTop: '4px', color: '#444' }
      }, 'Drag stones to move them')
    ),

    tasks.map(renderTask)
  );
}

function App() { return React.createElement(App); }