import type { Components, ItemCalc, OrderCalc, PlanStage, Status, TaskSchedule } from '@vudo/shared';
import type { LogFolder, MoneyAccess, NavItem, Role, Section, Settings } from '@vudo/shared';

export interface User {
  id: number;
  name: string;
  login: string;
  roles: Role[];
  phone: string | null;
  disabled: boolean;
  theme: 'light' | 'dark' | null;
  startSection: string | null;
  ordersRows: number | null;
}

export interface SessionInfo {
  user: User;
  nav: NavItem[];
  start: Section;
  money: MoneyAccess;
}

export interface Person {
  id: number;
  name: string;
  roles: Role[];
  phone: string | null;
  disabled: boolean;
}

export interface LogEntry {
  id: number;
  at: string;
  userId: number | null;
  userName: string;
  orderId: number | null;
  orderNum: string | null;
  text: string;
  folder: LogFolder;
  isNew: boolean;
}

export interface LogPage {
  entries: LogEntry[];
  hasMore: boolean;
  counters: Record<LogFolder, { new: number; total: number }>;
}

export type SettingsView = Partial<Settings> & Pick<Settings, 'avansPct' | 'markupPct' | 'designerPct' | 'norms'>;

/* ---------- Етап 2: замовлення, клієнти ---------- */

export interface NextStep {
  text: string;
  cls: '' | 'warn' | 'late';
}

export interface OrderListItem {
  id: number;
  num: string;
  createdDate: string;
  client: { id: number; name: string; phone: string | null };
  status: Status;
  statusSince: string;
  late: number;
  managerId: number;
  managerName: string;
  source: string | null;
  archived: boolean;
  itemNames: string[];
  price: number;
  paid: number;
  debt: number;
  contractDate: string | null;
  next: NextStep;
}

export interface ExecListItem {
  id: number;
  num: string;
  client: { name: string; phone: string | null };
  address: string | null;
  status: Status;
  itemNames: string[];
  myStages: PlanStage[];
  installDate: string | null;
}

export interface ClientFull {
  id: number;
  name: string;
  phone: string | null;
  type: string;
  source: string | null;
  email: string | null;
  messenger: string | null;
  company: string | null;
  bonusPct: number | null;
  addresses: string[];
  comment: string | null;
  archived: boolean;
}

export interface ClientRow extends ClientFull {
  ordersCount: number;
  purchases?: number;
  debt?: number;
  effectiveBonusPct?: number;
  activeCount?: number;
}

export interface ClientCard extends ClientFull {
  effectiveBonusPct: number;
  orders: OrderListItem[];
}

export interface OrderItem {
  id: number;
  name: string;
  type: string;
  description: string | null;
  pre: Components;
  exact: Components | null;
  designerPct: number | null;
  markupPct: number;
  calc: ItemCalc;
}

export interface OrderFile {
  id: number;
  category: 'design' | 'spec' | 'constr' | 'other';
  name: string;
  size: number;
  mime: string | null;
  createdAt: string;
  byName: string | null;
}

export interface OrderComment {
  id: number;
  text: string;
  createdAt: string;
  byName: string | null;
}

export interface PlanTask {
  id: number;
  orderId: number;
  stage: PlanStage;
  idx: number;
  assigneeId: number | null;
  assigneeName: string | null;
  startDate: string | null;
  days: number | null;
  progress: number;
  comment: string | null;
  sched: TaskSchedule;
}

export interface OfficeCard {
  view: 'office';
  id: number;
  num: string;
  createdDate: string;
  status: Status;
  statusSince: string;
  late: number;
  client: ClientFull;
  address: string | null;
  managerId: number;
  managerName: string;
  source: string | null;
  designer: { id: number; name: string; company: string | null; phone: string | null; bonusPct: number } | null;
  measureDate: string | null;
  measurerId: number | null;
  constructorId: number | null;
  installerIds: number[];
  readyDate: string | null;
  installDate: string | null;
  planInstall: string | null;
  delivery: number;
  discount: number;
  discountType: 'грн' | '%';
  contractDate: string | null;
  contractPrice: number | null;
  closedDate: string | null;
  refuseReason: string | null;
  claimText: string | null;
  comment: string | null;
  archived: boolean;
  items: OrderItem[];
  payments: { id: number; sum: number; type: string; method: string; date: string; comment: string | null; byName: string | null }[];
  files: OrderFile[];
  comments: OrderComment[];
  tasks: PlanTask[];
  history: { id: number; at: string; text: string; byName: string }[];
  issues: Issue[];
  reserved: ReservedStock[];
  sums: OrderCalc;
  owner: { margin: number; marginPct: number; opex: number; opexAuto: boolean; netProfit: number; netPct: number } | null;
  markupPct: number;
}

export interface ExecCard {
  view: 'exec';
  id: number;
  num: string;
  createdDate: string;
  status: Status;
  statusSince: string;
  client: { name: string; phone: string | null; messenger: string | null; email: string | null; addresses: string[]; comment: string | null };
  designer: { name: string; company: string | null; phone: string | null } | null;
  address: string | null;
  managerName: string;
  comment: string | null;
  measureDate: string | null;
  measurerName: string | null;
  readyDate: string | null;
  installDate: string | null;
  installerNames: string[];
  claimText: string | null;
  items: { id: number; name: string; type: string; description: string | null }[];
  files: OrderFile[];
  comments: OrderComment[];
  tasks: PlanTask[];
  myStages: PlanStage[];
  issues: Issue[];
  reserved: ReservedStock[];
}

export type OrderCard = OfficeCard | ExecCard;

/* ---------- Етап 3: виробництво ---------- */

export interface Issue {
  id: number;
  type: 'Не вистачає' | 'Брак деталі';
  text: string;
  qty: string | null;
  urgent: boolean;
  status: 'нове' | 'замовлено' | 'вирішено';
  createdAt: string;
  byName: string | null;
  itemName: string | null;
  photoId: number | null;
}

export interface ReservedStock {
  id: number;
  kind: string;
  material: string;
  thick: number | null;
  w: number | null;
  h: number | null;
  qty: number;
  unit: string;
  place: string | null;
}

export interface PlanTaskFull extends PlanTask {
  address: string | null;
  itemNames: string[];
  assigneeRoles: Role[];
  orderNum: string;
  clientName: string;
  installDate: string | null;
}

export interface PlanData {
  today: string;
  tasks: PlanTaskFull[];
  orders: { id: number; num: string; clientName: string }[];
}

export interface Visit {
  orderId: number;
  num: string;
  stage: 'Замір' | 'Монтаж';
  address: string | null;
  clientName: string;
  phone: string | null;
  comment: string | null;
  items: { id: number; name: string; type: string }[];
  files: { id: number; name: string; category: string; createdAt: string }[];
  taskIds: number[];
  done: boolean;
  issues: (Issue & { orderId: number })[];
}

export interface MyDayData {
  userId: number;
  day: string;
  people: { id: number; name: string; roles: Role[] }[];
  visits: Visit[];
  upcoming: { date: string; visits: Pick<Visit, 'orderId' | 'num' | 'stage' | 'address' | 'clientName'>[] }[];
}

export interface StockRow extends ReservedStock {
  fromOrderId: number | null;
  note: string | null;
  status: 'вільний' | 'резерв' | 'використано';
  resOrderId: number | null;
  createdAt: string;
  byName: string | null;
  fromNum: string | null;
  fromClient: string | null;
  resNum: string | null;
  resClient: string | null;
}
