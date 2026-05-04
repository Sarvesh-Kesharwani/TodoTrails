# TodoTrails attachment server

Small Render web service for task image uploads.

Required frontend env after Render deploy:

```txt
NEXT_PUBLIC_RENDER_ATTACHMENTS_URL=https://your-render-service.onrender.com
```

The free Render filesystem is not durable after rebuild/redeploy. For permanent image storage, attach a paid Render disk or replace disk writes with Supabase Storage.
