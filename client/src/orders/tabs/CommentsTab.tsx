import { useState } from 'react';
import { fmtDateTime } from '@vudo/shared';
import { api } from '../../api';
import type { OrderCard, OrderComment } from '../../types';
import { useToast } from '../../ui/toast';
import { useOrderAction } from '../hooks';

export function CommentsTab({ id, comments }: { id: number; comments: OrderComment[] }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const add = useOrderAction(id, (t: string) => api.post<OrderCard>(`/orders/${id}/comments`, { text: t }), 'Коментар додано');
  return (
    <form
      className="sec"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return toast('Напишіть текст коментаря.', true);
        add.mutate(text, { onSuccess: () => setText('') });
      }}
    >
      <h2>Коментарі</h2>
      <label className="f">
        Новий коментар
        <textarea value={text} placeholder="Напр.: клієнт просить перенести замір на суботу" onChange={(e) => setText(e.target.value)} />
      </label>
      <div>
        <button type="submit" className="btn pri" disabled={add.isPending}>
          Додати
        </button>
      </div>
      <div className="list">
        {comments.map((c) => (
          <div className="li" key={c.id}>
            <div className="m" style={{ whiteSpace: 'pre-wrap' }}>
              {c.text}
              <small>
                {c.byName} · {fmtDateTime(c.createdAt)}
              </small>
            </div>
          </div>
        ))}
      </div>
    </form>
  );
}
