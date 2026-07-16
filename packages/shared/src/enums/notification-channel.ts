// PLT-6-WA: tenant-level channel preference — which delivery channel(s) a tenant has enabled for
// its notifications. Defaults to EMAIL only everywhere a tenant hasn't configured this, so
// existing (pre-WhatsApp) behavior is unchanged unless a tenant explicitly opts in to WhatsApp.
export enum NotificationChannel {
  EMAIL = 'email',
  WHATSAPP = 'whatsapp',
}
