export class PagedResult<T> {
  data: T[];
  meta: { total: number; limit: number; offset: number };

  constructor(data: T[], total: number, limit: number, offset: number) {
    this.data = data;
    this.meta = { total, limit, offset };
  }
}
