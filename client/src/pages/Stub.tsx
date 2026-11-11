import type { Section } from '@vudo/shared';
import { useMe } from '../session';

/** Розділи, що з'являться на наступних етапах розробки (ТЗ розділ 16). */
const STAGE: Record<Section, number> = {
  orders: 2,
  crm: 2,
  clients: 2,
  plan: 3,
  myday: 3,
  stock: 3,
  notes: 1,
  finance: 4,
  stats: 4,
  kb: 5,
  time: 5,
  settings: 1,
};

export function Stub({ section }: { section: Section }) {
  const { nav } = useMe();
  const label = nav.find((n) => n.key === section)?.label ?? '';
  return (
    <>
      <div className="bar">
        <h1 className="grow">{label}</h1>
      </div>
      <div className="stub">
        <b>Розділ у розробці</b>
        <span>З'явиться на етапі {STAGE[section]} — за планом розробки ТЗ.</span>
      </div>
    </>
  );
}
