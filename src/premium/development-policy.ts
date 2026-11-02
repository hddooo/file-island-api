/** Temporary effective access for signed-in members only. Does not issue or rewrite any paid pass.
 * Set HANQ_DEVELOPMENT_PREMIUM_OPEN=false to restore the existing entitlement policy. */
export function developmentPremiumOpen(override?:boolean):boolean {
 if(typeof override==='boolean')return override;
 const value=process.env.HANQ_DEVELOPMENT_PREMIUM_OPEN;
 return value===undefined?process.env.NODE_ENV!=='test':value==='true';
}
