const http = require('http');
const app = require('../app');

let server;
const PORT = 3899;

function request(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request({ port: PORT, host: '127.0.0.1', ...options }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, body });
        }
      });
    });

    req.on('error', reject);
    if (data) {
      if (typeof data === 'object') {
        req.setHeader('Content-Type', 'application/json');
        req.write(JSON.stringify(data));
      } else {
        req.write(data);
      }
    }
    req.end();
  });
}

async function runTests() {
  console.log('🚀 Starting test server on port', PORT);
  server = app.listen(PORT);

  let passed = 0;
  let failed = 0;

  function assert(condition, name) {
    if (condition) {
      console.log(`  ✓ PASS: ${name}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${name}`);
      failed++;
    }
  }

  try {
    // 1. Test Registration & Login with SQLite
    console.log('\n--- 1. Testing Authentication ---');
    const regEmail = `node_test_${Date.now()}@example.com`;
    const regRes = await request(
      { path: '/api/register', method: 'POST' },
      { name: 'Node Test User', email: regEmail, password: 'password123', password_confirmation: 'password123' }
    );
    assert(regRes.status === 200, 'Register status 200');
    assert(regRes.body.status === true, 'Register success flag true');
    assert(!!regRes.body.data.token, 'Register token returned');

    const loginRes = await request(
      { path: '/api/login', method: 'POST' },
      { email: 'test@example.com', password: 'password' }
    );
    assert(loginRes.status === 200, 'Login status 200');
    assert(loginRes.body.status === true, 'Login status flag true');
    assert(!!loginRes.body.data.token, 'Auth token returned');
    const token = loginRes.body.data.token;

    // 2. Test User Profile
    console.log('\n--- 2. Testing User Profile & Dashboard ---');
    const profileRes = await request({
      path: '/api/user/profile',
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    assert(profileRes.status === 200, 'Profile status 200');
    assert(profileRes.body.data.email === 'test@example.com', 'Profile email matches');

    // 3. Test Dashboard
    const dashboardRes = await request({
      path: '/api/user/dashboard',
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    assert(dashboardRes.status === 200, 'Dashboard status 200');
    assert(Array.isArray(dashboardRes.body.data.bucket), 'Dashboard returns buckets array');

    // 4. Test Bucket Listing
    console.log('\n--- 3. Testing Bucket Operations ---');
    const bucketListRes = await request({
      path: '/api/bucket/list',
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    assert(bucketListRes.status === 200, 'Bucket list status 200');
    assert(bucketListRes.body.data.length > 0, 'User has existing buckets in SQLite');
    const existingBucket = bucketListRes.body.data[0];

    // 5. Test Bucket Share
    const shareRes = await request(
      {
        path: '/api/bucket/share',
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      },
      { bucket_id: existingBucket.id }
    );
    assert(shareRes.status === 200, 'Bucket share status 200');
    assert(!!shareRes.body.code, 'Share code generated');
    const shareCode = shareRes.body.code;

    // 6. Test Public Shared Bucket Display
    console.log('\n--- 4. Testing Shared Bucket & Public Endpoints ---');
    const sharedShowRes = await request({
      path: `/api/show/${shareCode}`,
      method: 'GET',
    });
    assert(sharedShowRes.status === 200, 'Public shared bucket display status 200');
    assert(sharedShowRes.body.data.bucket.code === shareCode, 'Shared bucket code matches');

    // 7. Test Chunk Upload Init & Status
    console.log('\n--- 5. Testing Chunk Upload System ---');
    const initRes = await request(
      {
        path: '/api/upload/init',
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      },
      {
        file_name: 'test_sample.mp4',
        file_size: 1048576,
        total_chunks: 1,
        bucket_id: existingBucket.id,
      }
    );
    assert(initRes.status === 200, 'Chunk upload init status 200');
    assert(!!initRes.body.data.upload_id, 'Upload ID generated');
    const uploadId = initRes.body.data.upload_id;

    // Unauthenticated status request MUST be blocked with 403
    const unauthStatusRes = await request({
      path: `/api/upload/status/${uploadId}`,
      method: 'GET',
    });
    assert(unauthStatusRes.status === 403, 'Unauthenticated status query returns 403 Forbidden');

    // Authenticated status request by owner MUST succeed with 200
    const statusRes = await request({
      path: `/api/upload/status/${uploadId}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    assert(statusRes.status === 200, 'Owner chunk upload status query returns 200');
    assert(['pending', 'uploading'].includes(statusRes.body.data.status), 'Initial status is pending or uploading');

    // 8. Test Admin Panel with Admin user
    console.log('\n--- 6. Testing Admin Panel ---');
    const adminLoginRes = await request(
      { path: '/api/login', method: 'POST' },
      { email: 'admin@admin.com', password: 'password' }
    );
    assert(adminLoginRes.status === 200, 'Admin login status 200');
    const adminToken = adminLoginRes.body.data.token;

    const statsRes = await request({
      path: '/api/admin/stats',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(statsRes.status === 200, 'Admin stats status 200');
    assert(statsRes.body.data.totalUsers >= 2, 'Admin stats counts users properly');

    const usersRes = await request({
      path: '/api/admin/users',
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(usersRes.status === 200, 'Admin users list status 200');
    assert(usersRes.body.data.data.length >= 2, 'Admin users list populated');

    // 9. Test OPTIONS Preflight on Stream & Thumbnail
    console.log('\n--- 7. Testing CORS & Preflight on Streaming ---');
    const optionsRes = await request({
      path: `/s/${existingBucket.id}/sample_file_id`,
      method: 'OPTIONS',
    });
    assert(optionsRes.status === 204, 'Stream OPTIONS preflight returns 204');
    assert(optionsRes.headers['access-control-allow-origin'] === '*', 'CORS origin allowed');

    // 10. Test Native WebDAV Drive Support (Windows, macOS, Linux)
    console.log('\n--- 8. Testing Native WebDAV Cloud Drive ---');
    const davOptionsRes = await request({
      path: '/webdav/',
      method: 'OPTIONS',
    });
    assert(davOptionsRes.status === 200, 'WebDAV OPTIONS returns 200 OK');
    assert(davOptionsRes.headers['dav'] === '1, 2', 'WebDAV announces DAV level 1, 2 support');
    assert(davOptionsRes.headers['ms-author-via'] === 'DAV', 'WebDAV announces MS-Author-Via: DAV');

    const davUnauthorizedRes = await request({
      path: '/webdav/',
      method: 'PROPFIND',
      headers: { Depth: '0' },
    });
    assert(davUnauthorizedRes.status === 401, 'WebDAV PROPFIND without auth returns 401 Unauthorized');
    assert(
      (davUnauthorizedRes.headers['www-authenticate'] || '').includes('Basic realm="Personal Cloud Drive"'),
      'WebDAV returns Basic realm header'
    );

    const basicAuth = Buffer.from('test@example.com:password').toString('base64');
    const davPropfindRes = await request({
      path: '/webdav/',
      method: 'PROPFIND',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        Depth: '1',
      },
    });
    assert(davPropfindRes.status === 207, 'WebDAV authenticated root PROPFIND returns 207 Multi-Status');
    assert(
      typeof davPropfindRes.body === 'string' && davPropfindRes.body.includes('<D:multistatus'),
      'WebDAV returns valid XML multistatus response'
    );
    assert(
      typeof davPropfindRes.body === 'string' && davPropfindRes.body.includes(encodeURIComponent(existingBucket.bucketName)),
      'WebDAV root listing includes user buckets as native directories'
    );

    // 11. Test WebDAV Instant Large File PUT & Immediate PROPFIND Presence
    console.log('\n--- 9. Testing WebDAV Instant Upload & Immediate Visibility ---');
    const testFileName = `test_large_document_${Date.now()}.txt`;
    const testFileContent = 'Hello Personal Cloud Drive WebDAV Instant Sync! ' + 'x'.repeat(1024 * 64); // 64KB sample
    const davPutRes = await request(
      {
        path: `/webdav/${encodeURIComponent(existingBucket.bucketName)}/${encodeURIComponent(testFileName)}`,
        method: 'PUT',
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'Content-Type': 'text/plain',
        },
      },
      testFileContent
    );
    assert(davPutRes.status === 201, 'WebDAV PUT returns 201 Created immediately without blocking');
    assert(
      (davPutRes.headers['location'] || '').includes(encodeURIComponent(testFileName)),
      'WebDAV PUT returns Location header with file URI'
    );

    // PROPFIND on bucket collection immediately reflects the newly uploaded file!
    const davBucketPropfindRes = await request({
      path: `/webdav/${encodeURIComponent(existingBucket.bucketName)}/`,
      method: 'PROPFIND',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        Depth: '1',
      },
    });
    assert(davBucketPropfindRes.status === 207, 'WebDAV bucket PROPFIND returns 207 Multi-Status');
    assert(
      typeof davBucketPropfindRes.body === 'string' && davBucketPropfindRes.body.includes(encodeURIComponent(testFileName)),
      'WebDAV PROPFIND lists the newly uploaded file immediately without waiting for cloud relay'
    );

    // GET & HEAD on the newly uploaded file reads directly from staged storage
    const davHeadRes = await request({
      path: `/webdav/${encodeURIComponent(existingBucket.bucketName)}/${encodeURIComponent(testFileName)}`,
      method: 'HEAD',
      headers: { Authorization: `Basic ${basicAuth}` },
    });
    assert(davHeadRes.status === 200, 'WebDAV HEAD on staged file returns 200 OK');
    assert(parseInt(davHeadRes.headers['content-length'], 10) === Buffer.byteLength(testFileContent), 'Content-Length matches exactly');

    const davGetRes = await request({
      path: `/webdav/${encodeURIComponent(existingBucket.bucketName)}/${encodeURIComponent(testFileName)}`,
      method: 'GET',
      headers: { Authorization: `Basic ${basicAuth}` },
    });
    assert(davGetRes.status === 200, 'WebDAV GET on staged file returns 200 OK');
    assert(davGetRes.body === testFileContent, 'WebDAV GET content matches staged payload');

    // DELETE on the staged file
    const davDelRes = await request({
      path: `/webdav/${encodeURIComponent(existingBucket.bucketName)}/${encodeURIComponent(testFileName)}`,
      method: 'DELETE',
      headers: { Authorization: `Basic ${basicAuth}` },
    });
    assert(davDelRes.status === 204, 'WebDAV DELETE returns 204 No Content and cancels queued upload');

    console.log('\n=============================================');
    console.log(`Results: ${passed} passed, ${failed} failed`);
    console.log('=============================================');
  } catch (err) {
    console.error('Test execution error:', err);
    failed++;
  } finally {
    server.close();
    process.exit(failed > 0 ? 1 : 0);
  }
}

runTests();
