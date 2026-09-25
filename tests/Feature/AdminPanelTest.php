<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class AdminPanelTest extends TestCase
{
    use RefreshDatabase;

    public function test_non_admin_cannot_access_admin_endpoints(): void
    {
        $regularUser = User::factory()->create([
            'role' => 'user',
            'status' => 'active',
        ]);

        $response = $this->actingAs($regularUser, 'sanctum')->getJson('/api/admin/stats');
        $response->assertStatus(403);

        $responseUsers = $this->actingAs($regularUser, 'sanctum')->getJson('/api/admin/users');
        $responseUsers->assertStatus(403);
    }

    public function test_admin_can_view_stats_and_users(): void
    {
        $admin = User::factory()->create([
            'role' => 'admin',
            'status' => 'active',
        ]);

        $user = User::factory()->create([
            'role' => 'user',
            'status' => 'active',
        ]);

        $statsRes = $this->actingAs($admin, 'sanctum')->getJson('/api/admin/stats');
        $statsRes->assertStatus(200);
        $statsRes->assertJsonStructure([
            'success',
            'data' => [
                'total_users',
                'active_users',
                'suspended_users',
                'admin_count',
                'total_buckets',
                'recent_users',
            ],
        ]);

        $usersRes = $this->actingAs($admin, 'sanctum')->getJson('/api/admin/users');
        $usersRes->assertStatus(200);
        $usersRes->assertJsonFragment(['email' => $user->email]);
    }

    public function test_admin_can_change_user_bucket_allowed_limit(): void
    {
        $admin = User::factory()->create([
            'role' => 'admin',
            'status' => 'active',
        ]);

        $user = User::factory()->create([
            'role' => 'user',
            'status' => 'active',
            'bucketAllowed' => 5,
        ]);

        $response = $this->actingAs($admin, 'sanctum')->postJson("/api/admin/users/{$user->id}/update", [
            'bucketAllowed' => 50,
        ]);

        $response->assertStatus(200);
        $this->assertSame(50, $user->fresh()->bucketAllowed);
    }

    public function test_admin_can_change_user_password(): void
    {
        $admin = User::factory()->create([
            'role' => 'admin',
            'status' => 'active',
        ]);

        $user = User::factory()->create([
            'role' => 'user',
            'status' => 'active',
            'password' => Hash::make('OldPassword123'),
        ]);

        $response = $this->actingAs($admin, 'sanctum')->postJson("/api/admin/users/{$user->id}/password", [
            'password' => 'NewSecretPassword999',
        ]);

        $response->assertStatus(200);
        $this->assertTrue(Hash::check('NewSecretPassword999', $user->fresh()->password));
    }

    public function test_admin_can_impersonate_user_without_password(): void
    {
        $admin = User::factory()->create([
            'name' => 'Super Admin',
            'role' => 'admin',
            'status' => 'active',
        ]);

        $targetUser = User::factory()->create([
            'name' => 'Target Client',
            'role' => 'user',
            'status' => 'active',
        ]);

        $response = $this->actingAs($admin, 'sanctum')->postJson("/api/admin/users/{$targetUser->id}/impersonate");

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'success',
            'data' => [
                'token',
                'user' => ['id', 'name', 'email', 'role'],
                'impersonated_by',
            ],
        ]);

        $impersonatedToken = $response->json('data.token');
        $this->assertNotEmpty($impersonatedToken);

        $this->app['auth']->forgetGuards();

        // Verify the impersonated token can access the user's profile
        $profileRes = $this->withHeader('Authorization', "Bearer {$impersonatedToken}")->getJson('/api/user/profile');
        $profileRes->assertStatus(200);
        $profileRes->assertJsonFragment(['email' => $targetUser->email]);
    }

    public function test_admin_can_suspend_user_and_suspended_user_cannot_login(): void
    {
        $admin = User::factory()->create([
            'role' => 'admin',
            'status' => 'active',
        ]);

        $user = User::factory()->create([
            'role' => 'user',
            'status' => 'active',
            'password' => Hash::make('ValidPass123'),
        ]);

        $toggleRes = $this->actingAs($admin, 'sanctum')->postJson("/api/admin/users/{$user->id}/toggle-status", [
            'reason' => 'Violation of terms',
        ]);

        $toggleRes->assertStatus(200);
        $this->assertSame('suspended', $user->fresh()->status);

        // Attempt login as suspended user
        $loginRes = $this->postJson('/api/login', [
            'email' => $user->email,
            'password' => 'ValidPass123',
        ]);

        $loginRes->assertStatus(422);
        $loginRes->assertJsonFragment(['message' => 'Your account has been suspended. Please contact the administrator.']);
    }
}
