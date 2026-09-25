<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Bucket;
use App\Models\User;
use App\Trait\ApiResponseTrait;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rule;

class AdminController extends Controller
{
    use ApiResponseTrait;

    /**
     * Get platform overview metrics.
     */
    public function stats(): JsonResponse
    {
        $totalUsers = User::count();
        $activeUsers = User::where('status', 'active')->count();
        $suspendedUsers = User::where('status', 'suspended')->count();
        $adminCount = User::where('role', 'admin')->count();
        $totalBuckets = Bucket::count();

        $recentUsers = User::withCount('buckets')
            ->latest()
            ->take(5)
            ->get(['id', 'name', 'email', 'role', 'status', 'bucketAllowed', 'created_at', 'last_login_at']);

        return $this->successResponse(
            data: [
                'total_users' => $totalUsers,
                'active_users' => $activeUsers,
                'suspended_users' => $suspendedUsers,
                'admin_count' => $adminCount,
                'total_buckets' => $totalBuckets,
                'recent_users' => $recentUsers,
            ],
            message: 'Admin metrics retrieved successfully'
        );
    }

    /**
     * List all users with search, filtering, and pagination.
     */
    public function users(Request $request): JsonResponse
    {
        $query = User::withCount('buckets')->latest();

        // Search by name or email
        if ($request->filled('search')) {
            $search = trim((string) $request->input('search'));
            $query->where(function ($q) use ($search) {
                $q->where('name', 'like', "%{$search}%")
                    ->orWhere('email', 'like', "%{$search}%");
            });
        }

        // Filter by role
        if ($request->filled('role') && in_array($request->input('role'), ['user', 'admin'], true)) {
            $query->where('role', $request->input('role'));
        }

        // Filter by status
        if ($request->filled('status') && in_array($request->input('status'), ['active', 'suspended'], true)) {
            $query->where('status', $request->input('status'));
        }

        $perPage = min(100, max(5, (int) $request->input('per_page', 15)));
        $users = $query->paginate($perPage);

        return $this->successResponse(
            data: $users,
            message: 'Users retrieved successfully'
        );
    }

    /**
     * View detailed user record with their buckets.
     */
    public function show(User $user): JsonResponse
    {
        $user->load(['buckets' => function ($q) {
            $q->latest();
        }]);
        $user->loadCount('buckets');

        return $this->successResponse(
            data: $user,
            message: 'User details retrieved successfully'
        );
    }

    /**
     * Update user details and quotas (e.g. bucketAllowed, role, name, email, status).
     */
    public function update(Request $request, User $user): JsonResponse
    {
        $validated = $request->validate([
            'name' => 'sometimes|required|string|max:255',
            'email' => [
                'sometimes',
                'required',
                'email',
                'max:255',
                Rule::unique('users')->ignore($user->id),
            ],
            'role' => 'sometimes|required|in:user,admin',
            'status' => 'sometimes|required|in:active,suspended',
            'status_reason' => 'nullable|string|max:255',
            'bucketAllowed' => 'sometimes|required|integer|min:0',
        ]);

        // Prevent admin from removing their own admin role
        if (isset($validated['role']) && $user->id === Auth::id() && $validated['role'] !== 'admin') {
            return $this->errorResponse(message: 'You cannot revoke your own administrator privileges', status: 400);
        }

        // Prevent admin from suspending themselves
        if (isset($validated['status']) && $user->id === Auth::id() && $validated['status'] === 'suspended') {
            return $this->errorResponse(message: 'You cannot suspend your own account', status: 400);
        }

        $user->update($validated);

        // If user is suspended, revoke all their active tokens
        if ($user->status === 'suspended') {
            $user->tokens()->delete();
        }

        return $this->successResponse(
            data: $user->fresh()->loadCount('buckets'),
            message: "User {$user->name} updated successfully"
        );
    }

    /**
     * Directly change/reset any user's password without old password.
     */
    public function changePassword(Request $request, User $user): JsonResponse
    {
        $request->validate([
            'password' => 'required|string|min:8|max:64',
        ]);

        $user->password = Hash::make($request->input('password'));
        $user->save();

        return $this->successResponse(
            data: ['id' => $user->id, 'email' => $user->email],
            message: "Password for {$user->name} updated successfully"
        );
    }

    /**
     * Impersonate user: Login as any user without their password or permission.
     */
    public function impersonate(Request $request, User $user): JsonResponse
    {
        if ($user->isSuspended()) {
            return $this->errorResponse(
                message: 'Cannot impersonate a suspended user account. Activate it first.',
                status: 400
            );
        }

        // Create an impersonation token for the target user
        $adminName = Auth::user()->name;
        $token = $user->createToken("impersonated_by_{$adminName}_".now()->timestamp)->plainTextToken;

        return $this->successResponse(
            data: [
                'token' => $token,
                'user' => [
                    'id' => $user->id,
                    'name' => $user->name,
                    'email' => $user->email,
                    'role' => $user->role,
                    'status' => $user->status,
                    'bucketAllowed' => $user->bucketAllowed,
                ],
                'impersonated_by' => [
                    'id' => Auth::id(),
                    'name' => Auth::user()->name,
                    'email' => Auth::user()->email,
                ],
            ],
            message: "Now logged in as {$user->name}"
        );
    }

    /**
     * Fast toggle account status (active <-> suspended).
     */
    public function toggleStatus(Request $request, User $user): JsonResponse
    {
        if ($user->id === Auth::id()) {
            return $this->errorResponse(message: 'You cannot suspend your own account', status: 400);
        }

        $newStatus = $user->status === 'active' ? 'suspended' : 'active';
        $user->status = $newStatus;
        if ($newStatus === 'suspended') {
            $user->status_reason = $request->input('reason', 'Suspended by Administrator');
            $user->tokens()->delete();
        } else {
            $user->status_reason = null;
        }
        $user->save();

        return $this->successResponse(
            data: $user->fresh(),
            message: "User {$user->name} is now {$newStatus}"
        );
    }

    /**
     * Delete user account.
     */
    public function destroy(Request $request, User $user): JsonResponse
    {
        if ($user->id === Auth::id()) {
            return $this->errorResponse(message: 'You cannot delete your own account', status: 400);
        }

        $userName = $user->name;

        // Revoke tokens and delete user
        $user->tokens()->delete();
        $user->delete();

        return $this->successResponse(
            message: "User {$userName} deleted successfully"
        );
    }
}
