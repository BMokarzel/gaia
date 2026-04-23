import React from 'react';

interface ProductCardProps {
  product: { id: string; name: string; price: number; stock: number };
  onClick: () => void;
  onAddToCart: () => void;
}

export function ProductCard({ product, onClick, onAddToCart }: ProductCardProps) {
  const handleClick = () => {
    onClick();
  };

  const handleAddToCart = () => {
    onAddToCart();
  };

  return (
    <div className="product-card" onClick={handleClick}>
      <h3>{product.name}</h3>
      <p>${product.price}</p>
      <button onClick={handleAddToCart} disabled={product.stock === 0}>
        {product.stock === 0 ? 'Out of Stock' : 'Add to Cart'}
      </button>
    </div>
  );
}
