import React, { useState } from 'react';

interface SearchBarProps {
  onSearch: (query: string) => void;
}

export function SearchBar({ onSearch }: SearchBarProps) {
  const [query, setQuery] = useState<string>('');

  const handleChange = (value: string) => {
    setQuery(value);
  };

  const handleSubmit = () => {
    onSearch(query);
  };

  return (
    <div className="search-bar">
      <input
        value={query}
        onChange={e => handleChange(e.target.value)}
        placeholder="Search products..."
      />
      <button onClick={handleSubmit}>Search</button>
    </div>
  );
}
