-- P&L: «Майбутні витрати закриті» — вводиться вручну за місяць; це частина витрат на замовлення з обліку.
ALTER TABLE pnl_plan DROP CONSTRAINT pnl_plan_line_check;
ALTER TABLE pnl_plan ADD CONSTRAINT pnl_plan_line_check CHECK (line IN ('income','orderCost','admin','payroll','other','marketing','tax','logistics','collab',
  'claim','credit','working','invPlus','invMinus','dividends','loan','futureClosed'));
