/**
 * React + Vite Starter Template
 * Ready for AI-assisted development
 */
import { useState } from 'react';

interface Item {
  id: number;
  name: string;
  done: boolean;
}

function App() {
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState('');

  const addItem = () => {
    if (!input.trim()) return;
    setItems([...items, { id: Date.now(), name: input, done: false }]);
    setInput('');
  };

  const toggleItem = (id: number) => {
    setItems(items.map(item => 
      item.id === id ? { ...item, done: !item.done } : item
    ));
  };

  const deleteItem = (id: number) => {
    setItems(items.filter(item => item.id !== id));
  };

  return (
    <div className="app">
      <h1>React + Vite</h1>
      
      <div className="input-row">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addItem()}
          placeholder="Add an item..."
        />
        <button onClick={addItem}>Add</button>
      </div>

      <ul className="item-list">
        {items.map(item => (
          <li key={item.id} className={item.done ? 'done' : ''}>
            <span onClick={() => toggleItem(item.id)}>{item.name}</span>
            <button onClick={() => deleteItem(item.id)}>×</button>
          </li>
        ))}
      </ul>

      {items.length === 0 && (
        <p className="empty">No items yet. Add something above!</p>
      )}
    </div>
  );
}

export default App;
