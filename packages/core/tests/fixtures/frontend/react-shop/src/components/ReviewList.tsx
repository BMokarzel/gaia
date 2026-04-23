import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';

interface ReviewListProps {
  productId: string;
}

export function ReviewList({ productId }: ReviewListProps) {
  const [newReview, setNewReview] = useState<string>('');
  const [rating, setRating] = useState<number>(5);

  const { data: reviews } = useQuery({
    queryKey: ['reviews', productId],
    queryFn: () => axios.get(`/api/products/${productId}/reviews`).then(r => r.data),
  });

  const handleSubmitReview = async () => {
    await axios.post(`/api/products/${productId}/reviews`, {
      text: newReview,
      rating,
    });
    setNewReview('');
  };

  const handleRatingChange = (value: number) => {
    setRating(value);
  };

  return (
    <div className="reviews">
      {(reviews ?? []).map((r: any) => (
        <div key={r.id}>{r.text} — {r.rating}★</div>
      ))}
      <textarea value={newReview} onChange={e => setNewReview(e.target.value)} />
      <input type="number" value={rating} onChange={e => handleRatingChange(Number(e.target.value))} />
      <button onClick={handleSubmitReview}>Submit Review</button>
    </div>
  );
}
