# Script for populating the database. You can run it as:
#
#     mix run priv/repo/seeds.exs

Code.require_file("seeds/users.exs", __DIR__)
Code.require_file("seeds/meetings.exs", __DIR__)
Code.require_file("seeds/documents.exs", __DIR__)
Code.require_file("seeds/transcripts.exs", __DIR__)
