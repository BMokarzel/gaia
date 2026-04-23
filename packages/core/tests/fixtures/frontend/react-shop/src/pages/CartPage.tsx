import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import axios from 'axios';
import analytics from '../utils/analytics';

interface CartItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
}

export default function CartPage() {
  const navigate = useNavigate();
  const items = useSelector((state: any) => state.cart.items);
  const dispatch = useDispatch();
  const [coupon, setCoupon] = useState<string>('');
  const [discount, setDiscount] = useState<number>(0);

  const handleApplyCoupon = async () => {
    const res = await axios.post('/api/coupons/validate', { code: coupon });
    setDiscount(res.data.discount);
  };

  const handleRemoveItem = async (productId: string) => {
    await axios.delete(`/api/cart/items/${productId}`);
    dispatch({ type: 'cart/removeItem', payload: productId });
  };

  const handleCheckout = async () => {
    analytics.track('checkout_started', { itemCount: items.length });
    const res = await axios.post('/api/orders', {
      items,
      couponCode: coupon || undefined,
    });
    navigate(`/orders/${res.data.orderId}/confirmation`);
  };

  const handleContinueShopping = () => {
    navigate('/products');
  };

  return (
    <div className="cart">
      {items.map((item: CartItem) => (
        <div key={item.productId}>
          <span>{item.name}</span>
          <button onClick={() => handleRemoveItem(item.productId)}>Remove</button>
        </div>
      ))}
      <input value={coupon} onChange={e => setCoupon(e.target.value)} placeholder="Coupon code" />
      <button onClick={handleApplyCoupon}>Apply Coupon</button>
      <button onClick={handleCheckout}>Checkout</button>
      <button onClick={handleContinueShopping}>Continue Shopping</button>
    </div>
  );
}
