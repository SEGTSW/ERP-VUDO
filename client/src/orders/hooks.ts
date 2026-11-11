import { useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorText } from '../api';
import type { OrderCard, Person } from '../types';
import { useToast } from '../ui/toast';

/** Картки замовлення / клієнта відкриваються поверх будь-якого розділу через параметр адреси (?order=ID, ?client=ID). */
export function useDrawer() {
  const [params, setParams] = useSearchParams();
  const orderId = Number(params.get('order')) || null;
  const clientId = Number(params.get('client')) || null;
  const tab = params.get('tab');
  const set = useCallback(
    (patch: Record<string, string | null>) =>
      setParams(
        (p) => {
          const n = new URLSearchParams(p);
          for (const [k, v] of Object.entries(patch)) {
            if (v == null) n.delete(k);
            else n.set(k, v);
          }
          return n;
        },
        { replace: false },
      ),
    [setParams],
  );
  return {
    orderId,
    clientId,
    tab,
    openOrder: (id: number, t?: string) => set({ order: String(id), client: null, tab: t ?? null }),
    openClient: (id: number) => set({ client: String(id), order: null, tab: null }),
    setTab: (t: string) => setParams((p) => {
      const n = new URLSearchParams(p);
      n.set('tab', t);
      return n;
    }, { replace: true }),
    close: () => set({ order: null, client: null, tab: null }),
  };
}

export function usePeople() {
  return useQuery({ queryKey: ['people'], queryFn: () => api.get<Person[]>('/people'), staleTime: 60_000 });
}

export function useOrderCard(id: number | null) {
  return useQuery({
    queryKey: ['order', id],
    queryFn: () => api.get<OrderCard>(`/orders/${id}`),
    enabled: id != null,
  });
}

/**
 * Зміна замовлення: сервер повертає оновлену картку — кладемо її в кеш
 * і оновлюємо списки (замовлення, CRM, клієнти, повідомлення).
 */
export function useOrderAction<V>(id: number, fn: (v: V) => Promise<OrderCard>, okMsg?: string | ((v: V) => string)) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: (card, v) => {
      qc.setQueryData(['order', id], card);
      void qc.invalidateQueries({ queryKey: ['orders'] });
      void qc.invalidateQueries({ queryKey: ['clients'] });
      void qc.invalidateQueries({ queryKey: ['client'] });
      void qc.invalidateQueries({ queryKey: ['log'] });
      if (okMsg) toast(typeof okMsg === 'function' ? okMsg(v) : okMsg);
    },
    onError: (e) => toast(errorText(e), true),
  });
}
