create the an file nginx.yaml with a service trustant-svc exposing the ports 4096 5173 and 8910

and an ingress nginx forwarding http and https on the root path to:
for the domains trustant.miniops.me on port 8910 trustant-ing
for the domain truacp.miniops.me on the port 4096 truacp-ing
for the domain vite.miniops.me on. the port 5173 vite-ing

write the same also for traefik.yaml with the same ingresses and service but for traefik

