<?php

namespace Tests\Feature;

use Tests\TestCase;

class PwaInstallabilityTest extends TestCase
{
    public function test_manifest_is_served_with_correct_mime_and_valid_pwa_fields(): void
    {
        $response = $this->get('/manifest.json');

        $response->assertStatus(200);
        $response->assertHeader('Content-Type', 'application/manifest+json; charset=UTF-8');

        $content = file_get_contents($response->baseResponse->getFile()->getPathname());
        $data = json_decode($content, true);
        $this->assertIsArray($data);
        $this->assertSame('CloudVault - Unlimited Cloud Storage', $data['name']);
        $this->assertSame('CloudVault', $data['short_name']);
        $this->assertSame('standalone', $data['display']);
        $this->assertSame('/?source=pwa', $data['start_url']);
        $this->assertSame('/', $data['scope']);
        $this->assertSame('/', $data['id']);

        $icons = $data['icons'];
        $this->assertNotEmpty($icons);

        $sizes = array_column($icons, 'sizes');
        $this->assertContains('192x192', $sizes);
        $this->assertContains('512x512', $sizes);
    }

    public function test_service_worker_is_served_with_correct_headers(): void
    {
        $response = $this->get('/sw.js');

        $response->assertStatus(200);
        $response->assertHeader('Content-Type', 'application/javascript; charset=UTF-8');
        $response->assertHeader('Service-Worker-Allowed', '/');
    }

    public function test_pwa_companion_is_served_with_correct_content_type(): void
    {
        $response = $this->get('/pwa-companion.js');

        $response->assertStatus(200);
        $response->assertHeader('Content-Type', 'application/javascript; charset=UTF-8');
    }

    public function test_pwa_icons_are_served_with_image_content_type(): void
    {
        $res192 = $this->get('/icons/icon-192.png');
        $res192->assertStatus(200);
        $res192->assertHeader('Content-Type', 'image/png');

        $res512 = $this->get('/icons/icon-512.png');
        $res512->assertStatus(200);
        $res512->assertHeader('Content-Type', 'image/png');
    }

    public function test_share_target_route_redirects_without_csrf_error(): void
    {
        $response = $this->post('/share-target');

        $response->assertStatus(302);
        $response->assertRedirect('/dashboard?shared=1');
    }
}
