-- Migration 02400 changed the OUT columns of the acquisition RPC by dropping
-- and recreating it.  Prompt PostgREST to discard the pre-02400 function
-- metadata before serving another checkout request.
notify pgrst, 'reload schema';
