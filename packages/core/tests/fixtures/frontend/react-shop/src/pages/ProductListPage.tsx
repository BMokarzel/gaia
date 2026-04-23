import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { ProductCard } from '../components/ProductCard';
import { SearchBar } from '../components/SearchBar';

interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
}

export default function ProductListPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const navigate = useNavigate();

  useEffect(() => {
    setLoading(true);
    axios.get('/api/products').then(res => {
      setProducts(res.data);
      setLoading(false);
    });
  }, []);

  const handleSearch = async (query: string) => {
    setSearch(query);
    const res = await axios.get(`/api/products?search=${query}`);
    setProducts(res.data);
  };

  const handleProductClick = (id: string) => {
    navigate(`/products/${id}`);
  };

  const handleAddToCart = async (productId: string) => {
    await axios.post('/api/cart/items', { productId, quantity: 1 });
    navigate('/cart');
  };

  return (
    <div className="product-list">
      <SearchBar onSearch={handleSearch} />
      {loading && <div>Loading...</div>}
      {products.map(p => (
        <ProductCard
          key={p.id}
          product={p}
          onClick={() => handleProductClick(p.id)}
          onAddToCart={() => handleAddToCart(p.id)}
        />
      ))}
    </div>
  );
}
