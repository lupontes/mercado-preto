"""Checks the rendered docker-compose.oci.yml against the edge-hardening spec.

Run: python3 -I infra/scripts/test_compose_oci.py
Uses `docker compose config` so it tests what Compose will actually apply,
not the raw YAML.
"""
import json
import pathlib
import subprocess
import unittest

INFRA = pathlib.Path(__file__).resolve().parent.parent
PUBLIC_URL = "https://teste.mercadopreto.com.br"


def render():
    out = subprocess.run(
        ["docker", "compose", "-f", str(INFRA / "docker-compose.oci.yml"),
         "--env-file", str(INFRA / ".env.template"), "config", "--format", "json"],
        check=True, capture_output=True, text=True,
    ).stdout
    return json.loads(out)


class ComposeOciTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.config = render()
        cls.services = cls.config["services"]

    def test_project_name_is_pinned_so_volumes_keep_their_names(self):
        self.assertEqual(self.config["name"], "infra")

    def test_only_nginx_publishes_ports_publicly(self):
        for name, service in self.services.items():
            for port in service.get("ports", []):
                if name == "nginx":
                    self.assertIn(str(port["published"]), {"80", "443"})
                else:
                    self.assertEqual(port.get("host_ip"), "127.0.0.1", f"{name} publishes {port}")

    def test_meilisearch_is_not_published(self):
        self.assertEqual(self.services["meilisearch"].get("ports", []), [])

    def test_nginx_reaches_host_storefront_via_host_gateway(self):
        extra = self.services["nginx"].get("extra_hosts", [])
        # Compose renders extra_hosts as a list ("name=ip") or a map
        # ({"name": ["ip"]}) depending on the version.
        if isinstance(extra, dict):
            hosts = [f"{k}:{v}" for k, vals in extra.items() for v in (vals if isinstance(vals, list) else [vals])]
        else:
            hosts = [h.replace("=", ":") for h in extra]
        self.assertIn("host.docker.internal:host-gateway", hosts)

    def test_nginx_mounts_config_directory_not_single_file(self):
        mounts = {v["target"]: v for v in self.services["nginx"]["volumes"]}
        self.assertTrue(mounts["/etc/nginx/oci"]["source"].endswith("infra/nginx/oci"))
        self.assertIn("/etc/nginx/oci/nginx.conf", " ".join(self.services["nginx"]["command"]))

    def test_nginx_keeps_container_name_so_existing_container_is_adopted(self):
        self.assertEqual(self.services["nginx"]["container_name"], "mercado-preto-nginx")

    def test_backend_public_urls_derive_from_public_url(self):
        env = self.services["medusa"]["environment"]
        self.assertEqual(env["BACKEND_URL"], f"{PUBLIC_URL}/api")
        for key in ("STORE_CORS", "ADMIN_CORS", "AUTH_CORS"):
            self.assertEqual(env[key], PUBLIC_URL, key)

    def test_backend_keeps_uploads_volume(self):
        mounts = {v["target"]: v["source"] for v in self.services["medusa"]["volumes"]}
        self.assertEqual(mounts["/app/static"], "backend_uploads")


if __name__ == "__main__":
    unittest.main()
