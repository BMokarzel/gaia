import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { ReviewList } from '../components/ReviewList';

interface Product {
  id: string;
  name: string;
  price: number;
  description: string;
  stock: number;
}

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [product, setProduct] = useState<Product | null>(null);
  const [quantity, setQuantity] = useState<number>(1);

  useEffect(() => {
    axios.get(`/api/products/${id}`).then(res => setProduct(res.data));
  }, [id]);

  const handleAddToCart = async () => {
    await axios.post('/api/cart/items', { productId: id, quantity });
    navigate('/cart');
  };

  const handleGoBack = () => {
    navigate('/products');
  };

  const handleQuantityChange = (value: number) => {
    setQuantity(value);
  };

  if (!product) return <div>Loading...</div>;

  return (
    <div className="product-detail">
      <button onClick={handleGoBack}>Back</button>
      <h1>{product.name}</h1>
      <p>{product.description}</p>
      <input
        type="number"
        value={quantity}
        onChange={e => handleQuantityChange(Number(e.target.value))}
      />
      <button onClick={handleAddToCart}>Add to Cart</button>
      <ReviewList productId={id!} />
    </div>
  );
}
